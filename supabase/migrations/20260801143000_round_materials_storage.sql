-- Migration — Round materials storage bucket (audit high-priority #5)
--
-- Admin material uploads wrote to the 'submissions' bucket at
-- `${roundId}/materials/...`, but that bucket's team-facing SELECT policy
-- requires the path's first folder segment to equal the team's own
-- auth.uid() (it's designed for per-team submission files) — a round id is
-- never a team id, so no team could ever satisfy that policy regardless of
-- what the UI rendered. Round materials are round-wide (every eligible
-- team should see the same file), which is a fundamentally different
-- access shape than per-team submissions, so this gets its own bucket
-- rather than a path hack on the submissions one.

set search_path = public, extensions;

insert into storage.buckets (id, name, public)
values ('round-materials', 'round-materials', false)
on conflict (id) do nothing;

-- Mirrors round_materials_select_authenticated (migration 004): any
-- registered team can see every round's materials metadata already
-- (`using (true)`), so the file bytes get the same posture — the round's
-- own qualification/status gating happens at the UI/round level, not here.
create policy "round_materials_bucket_select_authenticated"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'round-materials'
    and exists (
      select 1 from public.round_materials rm where rm.storage_path = name
    )
  );

-- Mirrors round_materials_select_public_released.
create policy "round_materials_bucket_select_public_released"
  on storage.objects for select
  to anon
  using (
    bucket_id = 'round-materials'
    and exists (
      select 1 from public.round_materials rm
      join public.rounds r on r.id = rm.round_id
      where rm.storage_path = name and rm.public_release and r.public_released_at is not null
    )
  );

-- Uploads/edits/deletes go through the service-role admin client from a
-- Server Action (same pattern as the submissions bucket), so only admin
-- needs a direct object-write policy here.
create policy "round_materials_bucket_admin_write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'round-materials' and public.is_admin());

create policy "round_materials_bucket_admin_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'round-materials' and public.is_admin())
  with check (bucket_id = 'round-materials' and public.is_admin());

create policy "round_materials_bucket_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'round-materials' and public.is_admin());
