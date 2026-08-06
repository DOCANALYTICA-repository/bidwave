-- Migration — Player stats privacy (audit P0 #1)
--
-- players_select_all (migration 006) granted select on the *entire* row —
-- including stats jsonb — to anon and authenticated with `using (true)`.
-- The paid-analytics unlock (analytics_requests, Phase 7) only ever gated
-- the app's UI page; a direct PostgREST call to /rest/v1/players always
-- returned full stats regardless of purchase status, invalidating the
-- unlock. This migration splits the public-safe columns (already the only
-- ones the public tracker and team-auction-roster page actually use) into
-- a curated view, and restricts base-table access to admins and teams with
-- an approved analytics request — the same "curated view bypasses RLS for
-- column curation" idiom already used by public_team_purses/
-- public_sales_feed/public_analytics_status (migrations 006/007).

set search_path = public, extensions;

create view public.players_public as
select
  id, event_edition_id, round_id, external_ref, full_name, role, base_price,
  pool, nationality, is_overseas, ipl_team, status, current_team_id,
  sale_price, sold_at, created_at, updated_at
from public.players;

comment on view public.players_public is
  'Every players column except stats — deliberately NOT security_invoker '
  '(same idiom as public_team_purses/public_sales_feed): the point is '
  'column curation that must not depend on which RLS policy the base table '
  'happens to carry. Public tracker (/live) and the team roster page read '
  'this instead of players directly; only the analytics page (gated below) '
  'reads players.stats.';

grant select on public.players_public to anon, authenticated;

drop policy "players_select_all" on public.players;

create policy "players_select_analytics_approved"
  on public.players for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.analytics_requests ar
      where ar.team_id = (select auth.uid()) and ar.status = 'approved'
    )
  );

comment on policy "players_select_analytics_approved" on public.players is
  'Replaces players_select_all (audit P0 #1). Full-row players access — '
  'including stats — is now admin-only or gated behind an approved '
  'analytics_requests row for that team; anon has no select policy on '
  'players at all (public callers use players_public instead).';
