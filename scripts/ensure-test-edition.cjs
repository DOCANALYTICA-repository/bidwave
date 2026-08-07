/**
 * npm run test:ensure-edition — idempotent bootstrap of a dedicated,
 * non-active `e2e-test` event_editions row, so the Playwright suite never
 * has to touch the live edition (see scripts/resolve-edition.cjs and
 * src/lib/event-edition.ts for the rest of this mechanism).
 *
 * event_editions has a partial unique index on `is_active` (exactly one
 * active edition, ever), so the test edition can never itself be active —
 * it's selected purely via BIDWAVE_EVENT_EDITION_SLUG. A brand-new edition
 * has no rounds/stages/stage_rounds/settings (those were seeded by
 * migrations scoped to whichever edition was active at the time), so this
 * clones them from the live edition on first run. simulation_config is
 * NOT cloned — seed-demo.cjs recreates it unconditionally. auction_state
 * is NOT cloned — the auction RPCs insert it lazily on first use.
 */
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");

const TEST_SLUG = process.env.BIDWAVE_EVENT_EDITION_SLUG || "e2e-test";

async function main() {
  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const { rows: liveRows } = await pg.query("select id from public.event_editions where is_active limit 1");
  if (!liveRows[0]) throw new Error("No active event edition to clone from — run migrations first.");
  const liveEditionId = liveRows[0].id;

  await pg.query("begin");
  try {
    const { rows: existing } = await pg.query(
      `insert into public.event_editions (name, slug, starts_on, ends_on, is_active,
         registration_opens_at, registration_closes_at)
       values ('Bidwave E2E Test Edition', $1, current_date, current_date + interval '3 days',
         false, now() - interval '30 days', now() + interval '365 days')
       on conflict (slug) do nothing
       returning id`,
      [TEST_SLUG],
    );

    let testEditionId;
    if (existing[0]) {
      testEditionId = existing[0].id;
      console.log(`Created test edition '${TEST_SLUG}' (${testEditionId}).`);
    } else {
      const { rows } = await pg.query("select id from public.event_editions where slug = $1", [TEST_SLUG]);
      testEditionId = rows[0].id;
    }

    const { rows: roundCount } = await pg.query(
      "select count(*)::int as n from public.rounds where event_edition_id = $1",
      [testEditionId],
    );

    if (roundCount[0].n === 0) {
      console.log(`Test edition '${TEST_SLUG}' has no rounds yet — cloning structural data from the live edition.`);

      await pg.query(
        `insert into public.rounds (event_edition_id, kind, sequence, slug, title, brief, instructions, rubric_total_mode)
         select $1, kind, sequence, slug, title, brief, instructions, rubric_total_mode
         from public.rounds where event_edition_id = $2`,
        [testEditionId, liveEditionId],
      );

      await pg.query(
        `insert into public.settings (event_edition_id, key, value, is_public)
         select $1, key, value, is_public
         from public.settings where event_edition_id = $2
         on conflict (event_edition_id, key) do nothing`,
        [testEditionId, liveEditionId],
      );

      await pg.query(
        `insert into public.stages (event_edition_id, code, label, tie_breaker_rules)
         select $1, code, label, tie_breaker_rules
         from public.stages where event_edition_id = $2`,
        [testEditionId, liveEditionId],
      );

      // stage_rounds joins stage <-> round by id — remap through the
      // (unique per edition) stage code and round slug rather than
      // copying the live edition's ids directly.
      await pg.query(
        `insert into public.stage_rounds (stage_id, round_id, weight)
         select ts.id, tr.id, sr.weight
         from public.stage_rounds sr
         join public.stages ls on ls.id = sr.stage_id and ls.event_edition_id = $2
         join public.rounds lr on lr.id = sr.round_id and lr.event_edition_id = $2
         join public.stages ts on ts.event_edition_id = $1 and ts.code = ls.code
         join public.rounds tr on tr.event_edition_id = $1 and tr.slug = lr.slug`,
        [testEditionId, liveEditionId],
      );

      console.log(`Cloned rounds/settings/stages/stage_rounds into '${TEST_SLUG}'.`);
    } else {
      console.log(`Test edition '${TEST_SLUG}' already has structural data (${roundCount[0].n} rounds) — leaving as-is.`);
    }

    await pg.query("commit");
    console.log(`Test edition ready: slug='${TEST_SLUG}' id=${testEditionId}`);
  } catch (e) {
    await pg.query("rollback");
    throw e;
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error("ENSURE-TEST-EDITION FAILED:", e.message);
  process.exit(1);
});
