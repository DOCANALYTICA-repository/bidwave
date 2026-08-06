/**
 * npm run unseed:demo — full "fresh slate" reset of the active event
 * edition. Originally this only removed what npm run seed:demo creates
 * (test.bidwave.local accounts + a wipe of purse/sales/scores/leaderboard).
 * That was too narrow: manual QA passes leave behind round lifecycle
 * progression, quiz/simulation attempts, analytics requests, audit/activity
 * logs, rate-limit counters, and orphaned storage files, none of which the
 * old script touched — so re-running seed:demo against an "unseeded" DB
 * still hit stale state. This version also wipes admin-authored *content*
 * (quiz question bank, rule sets) rather than just transactional data, since
 * whatever is in the DB today is itself placeholder/test content, not real
 * event material to preserve. Team deletion is also no longer scoped to
 * @test.bidwave.local — pre-event, everything in the active edition on
 * this hosted dev project is test data (see CLAUDE.md: it only becomes
 * real staging/production once local Docker dev is restored), so ALL
 * teams for the active edition are wiped, including ones registered
 * through the real /register UI during manual QA — those used to survive
 * unseed and silently corrupt team-count-sensitive tests/behaviour.
 *
 * purse_ledger is append-only (a trigger blocks UPDATE/DELETE even for the
 * postgres role) and rounds_no_reopen blocks closed_at going non-null→null
 * (a deliberate anti-cheat guard, see supabase/migrations
 * 20260730040000_rounds_scoring_leaderboards.sql) — both are disabled for
 * the duration of this script's own transaction only, exactly as before,
 * never in a way that weakens the guarantee for the running application.
 *
 * Delete order matters: analytics_requests and simulation_config (which
 * cascades to simulation_rewards) must go *before* purse_ledger, since both
 * hold a validating FK into it.
 */
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

async function main() {
  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const { rows: editionRows } = await pg.query("select id from public.event_editions where is_active limit 1");
  if (!editionRows[0]) {
    console.log("No active event edition — nothing to clean up.");
    await pg.end();
    return;
  }
  const eventEditionId = editionRows[0].id;

  let teamIds = [];
  await pg.query("begin");
  try {
    await pg.query("alter table public.purse_ledger disable trigger purse_ledger_append_only");
    await pg.query("alter table public.rounds disable trigger rounds_no_reopen");

    // --- rows that hold a validating FK into purse_ledger — delete first ---
    await pg.query("delete from public.analytics_requests where event_edition_id = $1", [eventEditionId]);
    await pg.query(
      "delete from public.simulation_config where event_edition_id = $1",
      [eventEditionId],
    ); // cascades simulation_attempts + simulation_rewards

    await pg.query("delete from public.leaderboard_snapshots where event_edition_id = $1", [eventEditionId]);
    await pg.query("delete from public.auction_sales where event_edition_id = $1", [eventEditionId]);
    // AUC's own live-state row (distinct from rounds.closed_at) — "auction
    // ended" is a one-way admin action (endAuction) with no undo in the UI,
    // so a prior manual test pass leaves it permanently ended otherwise.
    await pg.query(
      `update public.auction_state set
         round_id = null, active_player_id = null, started_at = null, ended_at = null, ended_by = null
       where event_edition_id = $1`,
      [eventEditionId],
    );
    await pg.query("delete from public.purse_ledger where event_edition_id = $1", [eventEditionId]);
    await pg.query("delete from public.players where event_edition_id = $1", [eventEditionId]);
    await pg.query("delete from public.auction_rule_sets where event_edition_id = $1", [eventEditionId]);

    await pg.query(
      "delete from public.scores where round_id in (select id from public.rounds where event_edition_id = $1)",
      [eventEditionId],
    );
    await pg.query(
      "delete from public.submissions where round_id in (select id from public.rounds where event_edition_id = $1)",
      [eventEditionId],
    ); // cascades submission_files

    // Quiz content + attempts (both scoped directly — quiz_questions and
    // quiz_attempts each carry event_edition_id, not just round_id).
    await pg.query("delete from public.quiz_attempts where event_edition_id = $1", [eventEditionId]); // cascades quiz_answers, quiz_events
    await pg.query("delete from public.quiz_questions where event_edition_id = $1", [eventEditionId]); // cascades quiz_options

    // Per-team stage progression — reset, but keep stage/stage_rounds
    // *definitions* (structural config, not test residue).
    await pg.query(
      "delete from public.qualifications where stage_id in (select id from public.stages where event_edition_id = $1)",
      [eventEditionId],
    );
    await pg.query(
      "delete from public.stage_adjustments where stage_id in (select id from public.stages where event_edition_id = $1)",
      [eventEditionId],
    );

    await pg.query("delete from public.activity_events where event_edition_id = $1", [eventEditionId]);
    await pg.query("delete from public.auction_audit_events where event_edition_id = $1", [eventEditionId]);

    // Round lifecycle progression reset — round *definitions* (title,
    // timing, kind) stay; only the clock-driven state a manual test pass
    // would have advanced goes back to null.
    await pg.query(
      `update public.rounds set
         opened_early_at = null,
         closed_at = null,
         scoring_started_at = null,
         scored_at = null,
         public_released_at = null,
         archived_at = null
       where event_edition_id = $1`,
      [eventEditionId],
    );

    // Rate-limit counters aren't edition-scoped (keyed by IP) — clear
    // globally so a load-tested IP doesn't stay capped into the next run.
    await pg.query("delete from public.rate_limit_buckets");

    // Pre-event, the active edition on the hosted dev project is entirely
    // test data (per CLAUDE.md: this project only becomes real
    // staging/production "once Docker is fixed" and local dev returns) —
    // so "fresh slate" means every team, not just the @test.bidwave.local
    // seed:demo accounts. A team registered through the real /register UI
    // during a manual QA pass (e.g. a genuine-looking captain email) used
    // to survive unseed and silently corrupt team-count-sensitive tests —
    // confirmed the hard way, see stage-standings test failures before this
    // widened scope.
    const { rows: teamRows } = await pg.query(
      "select id from public.teams where event_edition_id = $1",
      [eventEditionId],
    );
    teamIds = teamRows.map((r) => r.id);
    await pg.query("delete from public.team_members where team_id = any($1)", [teamIds]);
    await pg.query("delete from public.teams where id = any($1)", [teamIds]);

    await pg.query("alter table public.rounds enable trigger rounds_no_reopen");
    await pg.query("alter table public.purse_ledger enable trigger purse_ledger_append_only");
    await pg.query("commit");
  } catch (e) {
    await pg.query("rollback");
    await pg.end();
    throw e;
  }

  // Orphan cleanup: any auth.users row with role='team' but no matching
  // teams row — leftover from a run where the auth-delete step below
  // failed for some ids (the Auth Admin API itself throttles/times out
  // under heavy concurrency, confirmed via scripts/load-test-quiz.cjs at
  // ~250-300 simultaneous createUser calls) while the DB delete above
  // still succeeded for that same id, or from an interrupted prior run.
  const { rows: orphanRows } = await pg.query(
    `select u.id from auth.users u
     where (u.raw_app_meta_data ->> 'role') = 'team'
       and not exists (select 1 from public.teams t where t.id = u.id)`,
  );
  await pg.end();
  const authIdsToDelete = [...new Set([...teamIds, ...orphanRows.map((r) => r.id)])];

  // Storage cleanup happens after the DB transaction has committed —
  // there's nothing left to roll back for these, they're a best-effort
  // sweep of side effects the transaction can't itself undo.
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  for (const teamId of teamIds) {
    const { data: files } = await admin.storage.from("invoices").list(teamId);
    if (files && files.length > 0) {
      await admin.storage.from("invoices").remove(files.map((f) => `${teamId}/${f.name}`));
    }
  }
  for (const bucket of ["submissions", "round-materials"]) {
    const { data: files } = await admin.storage.from(bucket).list();
    if (files && files.length > 0) {
      await admin.storage.from(bucket).remove(files.map((f) => f.name));
    }
  }

  // teams.id === auth.users.id (1:1 — the team's captain account, see
  // register_team; other members never get their own auth.users row) —
  // delete directly by id. Deliberately NOT going through
  // auth.admin.listUsers(): its default page size (50) silently only
  // returns the first page, so at real load-test/seed scale (100s of
  // teams) most accounts were never even considered for deletion —
  // confirmed the hard way via a load test that got "already registered"
  // collisions on a supposedly-clean DB after this ran. The Admin API
  // itself throttles under heavy concurrency (also confirmed via the load
  // test), so a failed delete is retried a couple of times before being
  // reported as a real failure instead of being silently swallowed.
  async function deleteWithRetry(id, attemptsLeft = 3) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (!error || error.status === 404) return { id, ok: true };
    if (attemptsLeft > 1) return deleteWithRetry(id, attemptsLeft - 1);
    return { id, ok: false, error: error.message };
  }
  const deletions = await Promise.all(authIdsToDelete.map((id) => deleteWithRetry(id)));
  const failedDeletions = deletions.filter((d) => !d.ok);
  console.log(`Deleted ${deletions.length - failedDeletions.length}/${authIdsToDelete.length} auth user(s).`);
  if (failedDeletions.length > 0) {
    console.error(`FAILED to delete ${failedDeletions.length} auth user(s) after retries:`, failedDeletions);
    console.error("Re-run npm run unseed:demo — these will be picked up as orphans next time.");
    process.exitCode = 1;
    return;
  }

  console.log("Done — event edition reset to a fresh slate.");
}

main().catch((e) => {
  console.error("UNSEED FAILED:", e.message);
  process.exit(1);
});
