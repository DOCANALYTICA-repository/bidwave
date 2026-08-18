-- 20260818120000_revoke_stale_admin_save_score_overload.sql
--
-- Two overloads of admin_save_score existed live: the 7-arg one (no
-- p_admin_id) predates identity threading and contains no assert_admin/
-- is_admin check anywhere in its body, yet was left EXECUTE-able by anon and
-- authenticated. Migration 20260801100000_admin_identity_threading.sql
-- intended to drop it ("drop function if exists ... admin_save_score(uuid,
-- uuid, timestamptz, numeric, numeric, jsonb, text)") when it introduced the
-- correctly-locked 8-arg version, but that drop did not take effect on the
-- hosted project — both overloads were still present.
--
-- Net effect: any authenticated team (or anon, holding only the public
-- anon key) could call the 7-arg overload directly and write an arbitrary
-- score for any team in any round, fully bypassing RLS via SECURITY
-- DEFINER. tests/security.test.ts's "no public.* SECURITY DEFINER function
-- is executable by anon or authenticated, beyond the allowlist" check
-- caught this.
--
-- Fixed with a REVOKE, not a DROP, so this migration is safe to replay even
-- if the function is later removed by hand — `revoke ... from` on a
-- nonexistent grant is a no-op, whereas a DROP would error. The app itself
-- only ever calls the 8-arg form (src/app/admin/rounds/actions.ts passes
-- p_admin_id), so nothing depends on the vulnerable one remaining callable.
--
-- tests/security.test.ts's separate "no admin_* function has more than one
-- overload" check will keep failing until the stale 7-arg function is
-- actually dropped — tracked as follow-up, not done here to keep this
-- change minimal during a live event.

revoke all on function public.admin_save_score(
  uuid, uuid, timestamptz, numeric, numeric, jsonb, text
) from public, anon, authenticated;
