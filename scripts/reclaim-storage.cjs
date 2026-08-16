/**
 * npm run storage:reclaim — reports (and, with --apply, deletes) Storage
 * objects in the `submissions` bucket that no live submission references.
 *
 * WHY THIS EXISTS
 * ---------------
 * Storage on this project is a hard ceiling, not a bill: the project-wide
 * limit refuses individual objects over 50MB, and the plan's total
 * allowance refuses *everything* once exhausted. During Round 2 the
 * bucket reached 1.32GB, which is past the free plan's 1GB — a team
 * hitting that ceiling mid-round loses their submission window, so the
 * headroom matters more than the bytes.
 *
 * TWO CATEGORIES, VERY DIFFERENT RISK
 * -----------------------------------
 *   orphans     — objects with no `submission_files` row at all. These are
 *                 the debris of uploads that completed but whose
 *                 submission then failed (the pre-f0fcfc5 form abandoned
 *                 them on any error). Nothing in the app can ever reach
 *                 them again: no row, no path, no download. Safe.
 *
 *   superseded  — objects whose `submission_files` row has a
 *                 `superseded_at`, i.e. an earlier version of a submission
 *                 the team later replaced. The app does not serve these,
 *                 but the ROW SURVIVES either way — deleting the object
 *                 leaves a row pointing at nothing, which is what a judge
 *                 would see if a team ever disputed what they sent and
 *                 when. That is an evidence question, not a disk question,
 *                 so it is OPT-IN via --include-superseded and off by
 *                 default.
 *
 * USAGE
 *   node scripts/reclaim-storage.cjs                          # report only
 *   node scripts/reclaim-storage.cjs --apply                  # delete orphans
 *   node scripts/reclaim-storage.cjs --apply --include-superseded
 *
 * Deletes in batches, and never touches an object created in the last hour
 * — an upload in flight right now has no row yet either, and would
 * otherwise look exactly like an orphan.
 */
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const INCLUDE_SUPERSEDED = process.argv.includes("--include-superseded");
const BATCH = 100;

/**
 * An object younger than this has no row yet if its submission is still
 * being assembled in the browser. Well clear of the slowest upload seen
 * (45MB ≈ 68s from a desktop, minutes from a phone).
 */
const IN_FLIGHT_GRACE = "1 hour";

function mb(bytes) {
  return `${(Number(bytes || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await db.connect();

  const { rows: totals } = await db.query(
    `select count(*)::int objects, coalesce(sum((metadata->>'size')::bigint), 0) bytes
       from storage.objects where bucket_id = 'submissions'`,
  );
  console.log(`submissions bucket: ${totals[0].objects} objects, ${mb(totals[0].bytes)}`);

  const { rows: orphans } = await db.query(
    `select o.name, (o.metadata->>'size')::bigint size
       from storage.objects o
       left join submission_files f on f.storage_path = o.name
      where o.bucket_id = 'submissions'
        and f.id is null
        and o.created_at < now() - interval '${IN_FLIGHT_GRACE}'`,
  );

  const { rows: superseded } = await db.query(
    `select o.name, (o.metadata->>'size')::bigint size
       from storage.objects o
       join submission_files f on f.storage_path = o.name
      where o.bucket_id = 'submissions' and f.superseded_at is not null`,
  );

  const sum = (rows) => rows.reduce((n, r) => n + Number(r.size || 0), 0);
  console.log(`  orphans (no row at all):     ${orphans.length} objects, ${mb(sum(orphans))}`);
  console.log(`  superseded (replaced files): ${superseded.length} objects, ${mb(sum(superseded))}`);

  const targets = INCLUDE_SUPERSEDED ? [...orphans, ...superseded] : orphans;
  console.log(
    `\n${APPLY ? "DELETING" : "would delete"} ${targets.length} objects, ` +
      `${mb(sum(targets))} reclaimed` +
      (INCLUDE_SUPERSEDED ? " (including superseded)" : " (orphans only)"),
  );

  if (!APPLY) {
    console.log("\nReport only. Re-run with --apply to delete.");
    await db.end();
    return;
  }

  const storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  let removed = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const paths = targets.slice(i, i + BATCH).map((r) => r.name);
    const { error } = await storage.storage.from("submissions").remove(paths);
    if (error) {
      console.error(`batch ${i / BATCH + 1} failed: ${error.message}`);
      continue;
    }
    removed += paths.length;
    console.log(`  removed ${removed}/${targets.length}`);
  }

  const { rows: after } = await db.query(
    `select coalesce(sum((metadata->>'size')::bigint), 0) bytes
       from storage.objects where bucket_id = 'submissions'`,
  );
  console.log(`\nbucket now: ${mb(after[0].bytes)}`);
  await db.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
