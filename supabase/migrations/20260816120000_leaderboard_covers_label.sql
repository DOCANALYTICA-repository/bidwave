-- ---------------------------------------------------------------------------
-- LDB-03/PUB-04: say what a published leaderboard actually covers.
--
-- leaderboard_snapshots recorded kind/entry_limit/published_at and nothing
-- about which rounds fed it, so /leaderboard could only show a bare rank +
-- score. A viewer had no way to tell whether a standing was after Round 2 or
-- after Round 4 — and the heading said "Live Standings" for what is in fact a
-- hand-published static snapshot, which reads as continuously updating.
--
-- covers_label is deliberately free text set by the publishing admin ("After
-- Rounds 1 + 2"), not derived from stage_rounds: the Top 10 array is already
-- admin-ordered and never computed (R6-05/§18), so a derived label would be
-- the only part of the snapshot claiming an authority the numbers don't have.
--
-- Nullable, and every reader treats null as "no label" — the column is
-- additive and no existing snapshot needs backfilling (there are none
-- published yet; both editions are empty at the time of writing).
--
-- admin_publish_leaderboard gains p_covers_label. Its signature therefore
-- changes, which is exactly the hazard 20260807090000 documents at length:
-- `create or replace` against a new signature mints a SECOND function object
-- with Postgres's default PUBLIC EXECUTE and leaves the old one callable.
-- So the old signature is dropped explicitly first, and the new one gets its
-- own revoke/grant below. Verified before writing this that exactly one
-- overload existed (uuid,text,jsonb,integer,uuid), granted to service_role
-- only.
-- ---------------------------------------------------------------------------

alter table public.leaderboard_snapshots
  add column if not exists covers_label text;

comment on column public.leaderboard_snapshots.covers_label is
  'LDB-03/PUB-04: free-text description of what this snapshot covers, e.g. '
  '"After Rounds 1 + 2", shown to the public beside the publish time. Set by '
  'the publishing admin; never derived from stage_rounds.';

drop function if exists public.admin_publish_leaderboard(uuid, text, jsonb, int, uuid);

create function public.admin_publish_leaderboard(
  p_event_edition_id uuid,
  p_kind text,
  p_entries jsonb,
  p_entry_limit int,
  p_admin_id uuid,
  p_covers_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot_id uuid;
  v_entry jsonb;
  v_rank int := 0;
  v_covers_label text;
begin
  perform public.assert_admin(p_admin_id);

  if p_kind not in ('top_15', 'final_top_10') then
    raise exception '[invalid_kind] Unknown leaderboard kind.';
  end if;

  -- Normalize here rather than at the call site so a whitespace-only label
  -- can't reach the public page as an empty line under the heading.
  v_covers_label := nullif(btrim(coalesce(p_covers_label, '')), '');

  update public.leaderboard_snapshots
  set hidden_at = now()
  where event_edition_id = p_event_edition_id and kind = p_kind and hidden_at is null;

  insert into public.leaderboard_snapshots
    (event_edition_id, kind, entry_limit, published_by, covers_label)
  values (p_event_edition_id, p_kind, p_entry_limit, p_admin_id, v_covers_label)
  returning id into v_snapshot_id;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_rank := v_rank + 1;
    insert into public.leaderboard_snapshot_entries (snapshot_id, rank, team_name, score)
    values (
      v_snapshot_id,
      coalesce((v_entry ->> 'rank')::int, v_rank),
      v_entry ->> 'team_name',
      (v_entry ->> 'score')::numeric
    );
  end loop;

  perform public.broadcast_live(
    p_event_edition_id, 'leaderboard', 'published', jsonb_build_object('snapshot_id', v_snapshot_id, 'kind', p_kind)
  );

  return v_snapshot_id;
end;
$$;

comment on function public.admin_publish_leaderboard(uuid, text, jsonb, int, uuid, text) is
  'p_admin_id replaces auth.uid() for leaderboard_snapshots.published_by '
  '(audit P0 #4). Broadcasts on the leaderboard topic. p_covers_label '
  '(20260816120000) records what the snapshot covers for the public page.';

revoke all on function public.admin_publish_leaderboard(uuid, text, jsonb, int, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_publish_leaderboard(uuid, text, jsonb, int, uuid, text) to service_role;
