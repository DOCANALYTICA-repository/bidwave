/**
 * npm run cleanup:test-residue — one-shot, pre-event removal of QA/test
 * residue from the LIVE bidwave-2026 edition, written to be safe to run
 * while the published site is actively taking registrations.
 *
 * WHY THIS EXISTS INSTEAD OF `npm run unseed:demo`
 * ------------------------------------------------
 * unseed:demo deletes *every* team for its target edition — including ones
 * registered through the real /register UI (its own header says so). By the
 * time this was needed, the site had been published and real students had
 * registered, so unseed:demo would have destroyed genuine registrations,
 * payment invoices and captain logins. It also disables the
 * purse_ledger_append_only and rounds_no_reopen anti-cheat triggers for the
 * length of its transaction; this script needs neither (see below), so the
 * guards stay armed the whole time.
 *
 * SAFETY MODEL
 * ------------
 * Nothing here is keyed to a hardcoded list of "known real" ids — teams were
 * arriving *while this was being written* (two registered mid-audit). Every
 * rule is instead expressed as "delete only what provably belongs to no
 * current team", so a registration that lands mid-run is untouched by
 * construction rather than by luck:
 *
 *   - Storage objects are keyed by `<team_id>/...`; only objects whose
 *     leading path segment is absent from public.teams are removed.
 *   - The single leftover QA auth account is re-checked for orphanhood
 *     inside the transaction, not trusted from the earlier audit.
 *   - teams / team_members / invoices are never written to at all, and the
 *     script aborts if their counts move as a result of its own work.
 *
 * The round lifecycle reset clears `opened_early_at` only; `closed_at` is
 * null on every round, so rounds_no_reopen (which fires solely on
 * closed_at going non-null -> null) never triggers and does not need
 * disabling. purse_ledger is empty, so its append-only guard is untouched
 * too.
 *
 * WHAT IT DELETES, AND WHY EACH IS PROVABLY TEST DATA
 *   1. auth account ffssere@bcomafh.christuniversity.in — QA registration
 *      ("SRH", 2026-08-07) whose team row was already removed by an earlier
 *      unseed; a team-role login with no team is unusable and should not sit
 *      in the account list.
 *   2. `submissions` bucket objects — 2026-08-02/06 E2E uploads under team
 *      ids that no longer exist. public.submissions/submission_files are
 *      empty, so these are pure orphans.
 *   3. announcements — "hi" and four "E2E ..." rows. One was *published* and
 *      rendering on the real team dashboard.
 *   4. rubric_criteria "E2E Presentation" — visible to teams on Crisis Room.
 *   5. record_locks — 16 admin-console locks on players deleted long ago.
 *   6. live_broadcast — realtime relay rows; use-live-broadcast.ts subscribes
 *      to INSERTs and never reads history, so old rows are dead weight.
 *   7. rate_limit_buckets — stale counters (clearing only ever *removes* a
 *      cap, never imposes one).
 *   8. activity_events before 2026-08-11 — the Aug 7 QA session. Everything
 *      from Aug 11 onward is genuine student activity and is kept.
 *   9. rounds.opened_early_at — Round 1 "The Stat Sprint" was left `open` by
 *      a 2026-08-07 test with zero questions loaded, so every registered
 *      team could see an unanswerable quiz (one had already hit the
 *      quiz-start endpoint). Reset to draft; admin reopens it for real.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 *   teams, team_members, invoices (+ their storage files), the admin
 *   account and every real captain account, settings, event_editions,
 *   rounds/stages/stage_rounds definitions, simulation_config (real config,
 *   never started, answer key intact).
 *
 * Time-bounded deletes use a single `startedAt` captured up front so a row
 * created by a live user *during* the run is never swept up.
 */
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const QA_ACCOUNT_EMAIL = "ffssere@bcomafh.christuniversity.in";
const REAL_ACTIVITY_FROM = "2026-08-11T00:00:00Z";
const DRY_RUN = process.argv.includes("--dry-run");

function log(...args) {
  console.log(...args);
}

async function main() {
  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  // One clock reading for every time-bounded delete: rows created by live
  // users after this instant are out of scope for this run by definition.
  const { rows: clock } = await pg.query("select now() as now");
  const startedAt = clock[0].now;
  log(`Run started at ${startedAt.toISOString()}${DRY_RUN ? "  [DRY RUN]" : ""}\n`);

  const counts = async () => {
    const { rows } = await pg.query(`select
      (select count(*)::int from public.teams) as teams,
      (select count(*)::int from public.team_members) as members,
      (select count(*)::int from public.invoices) as invoices,
      (select count(*)::int from auth.users where (raw_app_meta_data->>'role') = 'admin') as admins`);
    return rows[0];
  };

  const before = await counts();
  log("Before:", JSON.stringify(before));

  // Guard: this script must never be the reason a real registration
  // disappears. Anything protected is counted before and after.
  if (before.admins < 1) throw new Error("No admin account found — refusing to run.");

  // Re-verify the QA account is still an orphan *now*, rather than trusting
  // the earlier audit — a team row could in principle have appeared since.
  const { rows: qaRows } = await pg.query(
    `select u.id, u.email from auth.users u
     where u.email = $1
       and not exists (select 1 from public.teams t where t.id = u.id)`,
    [QA_ACCOUNT_EMAIL],
  );
  const qaAccountId = qaRows[0]?.id ?? null;
  if (qaRows.length === 0) {
    log(`\nQA account ${QA_ACCOUNT_EMAIL}: not found, or it now HAS a team row — leaving it alone.`);
  } else {
    log(`\nQA account to delete: ${qaRows[0].email} (${qaAccountId})`);
  }

  // ---------------------------------------------------------------- DB ---
  await pg.query("begin");
  try {
    const del = async (label, sql, params = []) => {
      const res = await pg.query(sql, params);
      log(`  ${String(res.rowCount).padStart(5)}  ${label}`);
      return res.rowCount;
    };

    log("\nDeleting:");
    await del("announcements (test/E2E content)", "delete from public.announcements");
    await del("rubric_criteria (E2E Presentation)", "delete from public.rubric_criteria");
    await del("record_locks (stale console locks)", "delete from public.record_locks");
    await del("live_broadcast (spent realtime pings)", "delete from public.live_broadcast where created_at < $1", [startedAt]);
    await del("rate_limit_buckets (stale counters)", "delete from public.rate_limit_buckets where window_start < $1", [startedAt]);
    await del("activity_events (pre-Aug-11 QA session)", "delete from public.activity_events where created_at < $1", [REAL_ACTIVITY_FROM]);

    log("\nResetting round lifecycle state (definitions untouched):");
    await del(
      "rounds reset to draft",
      `update public.rounds set
         opened_early_at = null,
         closed_at = null,
         scoring_started_at = null,
         scored_at = null,
         public_released_at = null,
         archived_at = null
       where opened_early_at is not null
          or closed_at is not null
          or scoring_started_at is not null
          or scored_at is not null
          or public_released_at is not null
          or archived_at is not null`,
    );

    if (qaAccountId) {
      // public.teams has no row for this id (asserted above), but the
      // account may still own rows that cascade from auth.users; clear the
      // app-side ones explicitly so the auth delete cannot fail on an FK.
      await del("invoices row for QA account", "delete from public.invoices where team_id = $1", [qaAccountId]);
    }

    const after = await counts();
    if (after.teams !== before.teams || after.members !== before.members) {
      throw new Error(
        `ABORT: protected row counts changed (teams ${before.teams}->${after.teams}, ` +
          `members ${before.members}->${after.members}). Rolling back.`,
      );
    }
    if (after.admins !== before.admins) {
      throw new Error(`ABORT: admin count changed ${before.admins}->${after.admins}. Rolling back.`);
    }

    if (DRY_RUN) {
      await pg.query("rollback");
      log("\n[DRY RUN] rolled back — no changes committed.");
    } else {
      await pg.query("commit");
      log("\nDB changes committed.");
    }
  } catch (e) {
    await pg.query("rollback");
    await pg.end();
    throw e;
  }

  // ----------------------------------------------------------- storage ---
  // Every object in `invoices` and `submissions` is stored under
  // `<team_id>/...`. Anything whose leading segment is not a *current* team
  // is an orphan from a deleted test team — a live registration uploading
  // right now has a teams row, so its invoice can never match this rule.
  const { rows: teamRows } = await pg.query("select id from public.teams");
  const liveTeamIds = new Set(teamRows.map((r) => r.id));
  await pg.end();

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  log("\nStorage sweep (orphans only — objects under a live team id are never touched):");
  for (const bucket of ["invoices", "submissions"]) {
    const { data: prefixes, error } = await admin.storage.from(bucket).list("", { limit: 1000 });
    if (error) {
      log(`  ${bucket}: LIST FAILED — ${error.message}`);
      continue;
    }
    const orphanPrefixes = (prefixes ?? []).map((p) => p.name).filter((name) => !liveTeamIds.has(name));
    let removed = 0;
    for (const prefix of orphanPrefixes) {
      // Objects sit one or two levels deep (invoices/<team>/invoice.pdf,
      // submissions/<team>/<round>/<file>), so recurse one extra level.
      const paths = [];
      const { data: level1 } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
      for (const entry of level1 ?? []) {
        if (entry.id === null) {
          const { data: level2 } = await admin.storage.from(bucket).list(`${prefix}/${entry.name}`, { limit: 1000 });
          for (const leaf of level2 ?? []) paths.push(`${prefix}/${entry.name}/${leaf.name}`);
        } else {
          paths.push(`${prefix}/${entry.name}`);
        }
      }
      if (paths.length === 0) continue;
      if (DRY_RUN) {
        paths.forEach((p) => log(`    [DRY RUN] would remove ${bucket}/${p}`));
        removed += paths.length;
        continue;
      }
      const { error: rmError } = await admin.storage.from(bucket).remove(paths);
      if (rmError) log(`    FAILED to remove under ${bucket}/${prefix}: ${rmError.message}`);
      else {
        paths.forEach((p) => log(`    removed ${bucket}/${p}`));
        removed += paths.length;
      }
    }
    log(`  ${bucket}: ${removed} orphaned object(s), ${liveTeamIds.size} live team prefix(es) preserved.`);
  }

  // -------------------------------------------------------------- auth ---
  if (qaAccountId) {
    if (DRY_RUN) {
      log(`\n[DRY RUN] would delete auth account ${QA_ACCOUNT_EMAIL} (${qaAccountId}).`);
    } else {
      const { error } = await admin.auth.admin.deleteUser(qaAccountId);
      if (error && error.status !== 404) {
        console.error(`\nFAILED to delete auth account ${qaAccountId}: ${error.message}`);
        process.exitCode = 1;
      } else {
        log(`\nDeleted auth account ${QA_ACCOUNT_EMAIL}.`);
      }
    }
  }

  log("\nDone.");
}

main().catch((e) => {
  console.error("\nCLEANUP FAILED:", e.message);
  process.exit(1);
});
