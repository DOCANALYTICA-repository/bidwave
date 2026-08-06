-- Migration — Round lifecycle & submission-download workflow fixes
-- (audit high-priority #11, #6)
--
-- Two small, independent bug fixes bundled together — neither shares code
-- with the other, but both are proportionate "tighten a round's lifecycle
-- semantics" changes at the same risk class.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- #11. start_scoring allowed scoring to begin once closes_at merely
-- elapsed, without stamping closed_at — but release_publicly requires
-- closed_at is not null. A round that auto-closed via the clock (never
-- manually close_now'd) could enter/finish scoring and then get
-- permanently stuck unable to publish. Fix: start_scoring also stamps
-- closed_at (coalesce — a round already manually closed keeps its real
-- closed_at, this only fills the gap for the clock-only path).
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_round_lifecycle(p_round_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if v_round.id is null then
    raise exception '[not_found] Round not found.';
  end if;

  if p_action = 'open_now' then
    if v_round.closed_at is not null then
      raise exception '[round_already_closed] A closed round cannot be reopened.';
    end if;
    update public.rounds set opened_early_at = now() where id = p_round_id;

  elsif p_action = 'close_now' then
    update public.rounds set closed_at = now() where id = p_round_id and closed_at is null;

  elsif p_action = 'start_scoring' then
    if v_round.closed_at is null and (v_round.closes_at is null or now() < v_round.closes_at) then
      raise exception '[round_not_closed] Scoring can only start once the round is closed.';
    end if;
    update public.rounds set
      scoring_started_at = now(),
      closed_at = coalesce(closed_at, now())
    where id = p_round_id and scoring_started_at is null;

  elsif p_action = 'mark_scored' then
    update public.rounds set scored_at = now() where id = p_round_id and scored_at is null;

  elsif p_action = 'release_publicly' then
    if v_round.closed_at is null or v_round.scored_at is null then
      raise exception '[round_not_scored] A round can only be released publicly once closed and scored.';
    end if;
    update public.rounds set public_released_at = now() where id = p_round_id and public_released_at is null;

  elsif p_action = 'unrelease' then
    update public.rounds set public_released_at = null where id = p_round_id;

  elsif p_action = 'archive' then
    update public.rounds set archived_at = now() where id = p_round_id and archived_at is null;

  else
    raise exception '[invalid_action] Unknown round lifecycle action.';
  end if;
end;
$$;

comment on function public.admin_set_round_lifecycle(uuid, text) is
  'start_scoring now also stamps closed_at (coalesced, never overwriting a '
  'real manual close) so a round that auto-closed purely via the clock can '
  'still reach release_publicly later, instead of getting permanently '
  'stuck once scored (audit high-priority #11).';

-- ---------------------------------------------------------------------------
-- #6. "No submission download after close" was implemented as a blocklist
-- (effective_round_status(r) <> 'closed'), which unintentionally reopens
-- access the moment a round advances past 'closed' into scoring/scored/
-- publicly_released/archived. An allowlist (= 'open') can't be silently
-- bypassed by a future status value the same way a blocklist can.
-- ---------------------------------------------------------------------------

drop policy if exists "submission_files_select_own_or_admin" on public.submission_files;
create policy "submission_files_select_own_or_admin"
  on public.submission_files for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.submissions s
      join public.rounds r on r.id = s.round_id
      where s.id = submission_files.submission_id
        and s.team_id = (select auth.uid())
        and public.effective_round_status(r) = 'open'
    )
  );

comment on policy "submission_files_select_own_or_admin" on public.submission_files is
  '§9.1: teams cannot see (and therefore cannot download) their files once '
  'the round leaves ''open'' — an allowlist, not a ''<> closed'' blocklist, '
  'so scoring/scored/publicly_released/archived are all correctly denied '
  '(audit high-priority #6, previously only ''closed'' itself was denied).';

drop policy if exists "submissions_bucket_select_own_or_admin" on storage.objects;
create policy "submissions_bucket_select_own_or_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'submissions'
    and (
      public.is_admin()
      or (
        (storage.foldername(name))[1] = (select auth.uid()::text)
        and exists (
          select 1 from public.rounds r
          where r.id::text = (storage.foldername(name))[2]
            and public.effective_round_status(r) = 'open'
        )
      )
    )
  );
