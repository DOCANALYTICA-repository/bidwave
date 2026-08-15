-- ---------------------------------------------------------------------------
-- Recreate rounds_with_status so it actually exposes the columns added by
-- 20260814050000_quiz_retest_round.sql.
--
-- The view is defined as `select r.*, effective_round_status(r) as status`,
-- and Postgres expands `*` ONCE, at view-creation time, into a fixed column
-- list stored in the view definition. Adding columns to public.rounds
-- therefore does NOT add them to this view — and `create or replace view`
-- cannot add columns either, so the view has to be dropped and rebuilt.
--
-- Consequence while it was stale: every surface in the app reads
-- rounds_with_status rather than rounds (that is the documented convention
-- — see the view's own comment), so supersedes_round_id, is_invite_only,
-- quiz_exit_policy and quiz_strike_limit all came back undefined. The
-- re-attempt round's invite-only filter on the team dashboard silently let
-- every team see it, and the admin Round policy form rendered an empty
-- strike-limit field that failed validation on save. Caught by the e2e
-- suite, not by types or unit tests: types.ts is hand-written and claimed
-- the columns existed, and the RPC-level tests all read public.rounds
-- directly.
--
-- Anything that adds a column to public.rounds in future has to come back
-- here too.
-- ---------------------------------------------------------------------------

drop view if exists public.rounds_with_status;

create view public.rounds_with_status
with (security_invoker = true)
as
select r.*, public.effective_round_status(r) as status
from public.rounds r;

-- DROP takes the view's grants with it; Supabase's schema-level default
-- privileges only apply to objects created by the role that owns them, so
-- re-grant explicitly rather than assuming. SELECT only: this is a
-- security_invoker view over an RLS-protected table, and nothing writes
-- through it.
grant select on public.rounds_with_status to anon, authenticated, service_role;

comment on view public.rounds_with_status is
  'App code queries this, not rounds directly, so effective status never '
  'needs recomputing client-side. security_invoker = true so it inherits '
  'the caller''s RLS rather than the view owner''s. NOTE: the `r.*` here is '
  'expanded and frozen at creation time — any migration adding a column to '
  'public.rounds must drop and recreate this view or the new column will be '
  'invisible to every consumer (20260815070000).';
