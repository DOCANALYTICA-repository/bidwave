/**
 * npm run seed:demo — TECH-05: synthetic teams, players and scores for a
 * realistic pre-event rehearsal. No real student PII, no IPL trademarks:
 * every name is generic ("Franchise Alpha", "Player 07"), every email is
 * `*.test.bidwave.local` (same convention as tests/helpers/db.ts).
 *
 * Plain CommonJS (package.json has no "type": "module") — same pg +
 * .env.local pattern as tests/helpers/db.ts and the throwaway migration-
 * apply scripts, but this one *commits* (no rollback): it's meant to leave
 * data behind for a rehearsal, not to test something ephemeral.
 *
 * Idempotent-ish: bails out early if demo teams already exist, so running
 * this twice by mistake doesn't double-seed.
 *
 * Every demo account (admin + every team captain) shares one fixed,
 * printed password — this is throwaway rehearsal data seeded straight into
 * a non-production project, not real credentials, so a memorable shared
 * password is more useful here than an unrecoverable random one per team.
 */
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");
const { resolveEditionOrAbort } = require("./resolve-edition.cjs");

const DEMO_PASSWORD = "BidwaveDemo!1";

const TEAM_NAMES = [
  "Franchise Alpha", "Franchise Bravo", "Franchise Charlie", "Franchise Delta",
  "Franchise Echo", "Franchise Foxtrot", "Franchise Golf", "Franchise Hotel",
  "Franchise India", "Franchise Juliett", "Franchise Kilo", "Franchise Lima",
];

const ROLES = ["Batter", "Bowler", "All-rounder", "Wicketkeeper"];
const POOLS = ["A", "B", "C", "D"];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const edition = await resolveEditionOrAbort(pg);
  const eventEditionId = edition.id;

  // Independent of the team-seeding early-return below: `unseed:demo`
  // unconditionally deletes every simulation_config row for the target
  // edition (it must, to cascade away test attempts/rewards), so it needs
  // recreating on every seed:demo run. The parameters/scoring shape and
  // the answer-key generation both live in the database now
  // (public.seed_simulation_config, 20260807100000) — the plan forbids
  // committing the actual answer key anywhere in the repo, so this script
  // no longer builds or contains one at all.
  const { rows: simConfigRows } = await pg.query(
    "select id from public.simulation_config where event_edition_id = $1",
    [eventEditionId],
  );
  if (!simConfigRows[0]) {
    console.log("Seeding simulation_config (parameters + a freshly generated answer key)...");
    await pg.query("select public.seed_simulation_config($1)", [eventEditionId]);
  }

  // Scoped to the target edition — unscoped, this falsely short-circuited
  // seeding the test edition whenever the live edition already had demo
  // teams (or vice versa), since team names are reused verbatim across
  // editions by design.
  const { rows: existing } = await pg.query(
    "select count(*) as n from public.teams where name = $1 and event_edition_id = $2",
    [TEAM_NAMES[0], eventEditionId],
  );
  if (Number(existing[0].n) > 0) {
    console.log("Demo data already present (found '" + TEAM_NAMES[0] + "') — nothing to do.");
    await pg.end();
    return;
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Seeding one demo admin account...");
  const adminEmail = "admin@test.bidwave.local";
  // Looked up through pg, not admin.auth.admin.listUsers(): that call
  // paginates at 50 users per page and only ever fetched page one, so once
  // the project passed 50 auth users the existing demo admin stopped being
  // found and the createUser below failed the whole seed with "A user with
  // this email address has already been registered" — taking every e2e run
  // with it. auth.users is the authority and needs no paging.
  const { rows: adminRows } = await pg.query("select id from auth.users where email = $1", [adminEmail]);
  let adminUserId = adminRows[0]?.id;
  if (!adminUserId) {
    const { data: adminUser, error: adminError } = await admin.auth.admin.createUser({
      email: adminEmail,
      password: DEMO_PASSWORD,
      email_confirm: true,
      app_metadata: { role: "admin" },
    });
    if (adminError) throw adminError;
    adminUserId = adminUser.user.id;
  }

  console.log(`Seeding ${TEAM_NAMES.length} teams...`);
  const teamIds = [];
  for (let t = 0; t < TEAM_NAMES.length; t++) {
    const name = TEAM_NAMES[t];
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const email = `captain-${slug}@test.bidwave.local`;
    const { data: user, error } = await admin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      app_metadata: { role: "team" },
    });
    if (error) throw error;

    await pg.query(
      `insert into public.teams (id, event_edition_id, name, campus, captain_email, status)
       values ($1, $2, $3, 'Bangalore', $4, 'active')`,
      [user.user.id, eventEditionId, name, email],
    );

    for (let i = 0; i < 3; i++) {
      await pg.query(
        `insert into public.team_members (team_id, event_edition_id, full_name, class, register_number, phone, christ_email, is_captain)
         values ($1, $2, $3, 'I BCom', $4, '9999999999', $5, $6)`,
        [
          user.user.id,
          eventEditionId,
          `${name} Member ${i + 1}`,
          `DEMO${String(t).padStart(2, "0")}${i}`,
          `member${i}-${slug}@test.bidwave.local`,
          i === 0,
        ],
      );
    }
    teamIds.push(user.user.id);
  }

  console.log("Seeding auction rule set + starting purses...");
  let { rows: ruleSetRows } = await pg.query(
    "select id from public.auction_rule_sets where event_edition_id = $1 and is_active",
    [eventEditionId],
  );
  let ruleSetId = ruleSetRows[0]?.id;
  if (!ruleSetId) {
    const { rows } = await pg.query(
      `insert into public.auction_rule_sets (event_edition_id, is_active, starting_purse, min_squad_size, max_squad_size, max_overseas, analytics_price)
       values ($1, true, 100000000, 11, 18, 4, 500) returning id`,
      [eventEditionId],
    );
    ruleSetId = rows[0].id;
  }
  for (const teamId of teamIds) {
    await pg.query(
      `insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount)
       values ($1, $2, 'start', 100000000)
       on conflict (team_id) where (entry_kind = 'start') do nothing`,
      [eventEditionId, teamId],
    );
  }

  console.log("Seeding 80 players...");
  const playerIds = [];
  for (let i = 0; i < 80; i++) {
    const { rows } = await pg.query(
      `insert into public.players (event_edition_id, external_ref, full_name, role, base_price, pool, nationality, is_overseas)
       values ($1, $2, $3, $4, $5, $6, 'India', $7)
       returning id`,
      [
        eventEditionId,
        `DEMO-${String(i + 1).padStart(3, "0")}`,
        `Player ${String(i + 1).padStart(2, "0")}`,
        randomFrom(ROLES),
        (500 + Math.floor(Math.random() * 20) * 100),
        randomFrom(POOLS),
        Math.random() < 0.2,
      ],
    );
    playerIds.push(rows[0].id);
  }

  console.log("Recording a handful of sales via record_sale()...");
  for (let i = 0; i < 24; i++) {
    const playerId = playerIds[i];
    const teamId = teamIds[i % teamIds.length];
    // ::text avoids node-pg parsing timestamptz into a JS Date (millisecond
    // precision), which would round-trip back with less precision than
    // Postgres actually stored and trip record_sale's staleness check —
    // same fix tests/helpers/db.ts's createTestPlayer already applies.
    const { rows: playerRow } = await pg.query("select updated_at::text from public.players where id = $1", [playerId]);
    try {
      await pg.query("select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid)", [
        playerId,
        teamId,
        800 + Math.floor(Math.random() * 10) * 100,
        playerRow[0].updated_at,
        adminUserId,
      ]);
    } catch (e) {
      console.warn(`  sale ${i} skipped: ${e.message}`);
    }
  }

  console.log("Seeding Round 6 (conference) scores for every team...");
  const { rows: conferenceRound } = await pg.query(
    "select id from public.rounds where event_edition_id = $1 and kind = 'conference' limit 1",
    [eventEditionId],
  );
  if (conferenceRound[0]) {
    for (const teamId of teamIds) {
      const total = 60 + Math.floor(Math.random() * 40);
      await pg.query(
        `insert into public.scores (round_id, team_id, total, max_total, source, published)
         values ($1, $2, $3, 100, 'manual', true)
         on conflict (round_id, team_id) do update set total = excluded.total`,
        [conferenceRound[0].id, teamId, total],
      );
    }
  }

  console.log("Publishing demo leaderboard snapshots...");
  const { rows: teamRows } = await pg.query(
    "select id, name from public.teams where event_edition_id = $1 order by random() limit 15",
    [eventEditionId],
  );
  const top15Entries = teamRows.map((t, i) => ({ rank: i + 1, team_name: t.name, score: 100 - i * 3 }));
  await pg.query("select public.admin_publish_leaderboard($1, 'top_15', $2::jsonb, 15, $3::uuid)", [
    eventEditionId,
    JSON.stringify(top15Entries),
    adminUserId,
  ]);
  const top10Entries = top15Entries.slice(0, 10);
  await pg.query("select public.admin_publish_leaderboard($1, 'final_top_10', $2::jsonb, 10, $3::uuid)", [
    eventEditionId,
    JSON.stringify(top10Entries),
    adminUserId,
  ]);

  console.log("Done. Seeded:");
  console.log(`  Admin login: ${adminEmail} / ${DEMO_PASSWORD}`);
  console.log(`  ${teamIds.length} team logins: captain-franchise-alpha@test.bidwave.local, captain-franchise-bravo@test.bidwave.local, ... (same pattern for all 12) / ${DEMO_PASSWORD}`);
  console.log(`  ${playerIds.length} players, 24 sales, Round 6 scores, 2 leaderboard snapshots.`);

  await pg.end();
}

main().catch((e) => {
  console.error("SEED FAILED:", e.message);
  process.exit(1);
});
