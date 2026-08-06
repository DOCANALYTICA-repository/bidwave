/**
 * Automated load test for ~100 concurrent registrations (QA item #9).
 *
 * Exercises the exact 3-hop chain src/app/register/actions.ts performs —
 * auth.admin.createUser -> storage upload -> register_team() RPC — directly
 * against the hosted dev Supabase project, in parallel, bypassing the
 * Next.js server action layer (no dev server needed) and the app-level
 * rate limiter (that's a separate, already-diagnosed concern: 8/hour/IP
 * was the actual "failure" a same-IP load test would hit first, raised to
 * 60/hour in src/app/register/actions.ts — this script measures the DB/
 * Auth/Storage layer's own concurrency behavior, not the limiter).
 *
 * Usage: node scripts/load-test-registration.cjs [count]
 * Cleanup: npm run unseed:demo (all teams for the active edition, not just
 * @test.bidwave.local, are wiped — see unseed-demo.cjs's own header).
 */
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const COUNT = Number(process.argv[2]) || 100;
const RUN_ID = Math.floor(Math.random() * 1e9);

function makeTeam(i) {
  const suffix = `${RUN_ID}-${i}`;
  return {
    teamName: `Load Test Team ${suffix}`,
    campus: "Bangalore",
    members: [
      { fullName: `Captain ${suffix}`, className: "BCom", registerNumber: `REG-C-${suffix}`, phone: "9000000000", christEmail: `captain-${suffix}@bcom.christuniversity.in`, isCaptain: true },
      { fullName: `Member2 ${suffix}`, className: "BCom", registerNumber: `REG-2-${suffix}`, phone: "9000000001", christEmail: `member2-${suffix}@bcom.christuniversity.in`, isCaptain: false },
      { fullName: `Member3 ${suffix}`, className: "BCom", registerNumber: `REG-3-${suffix}`, phone: "9000000002", christEmail: `member3-${suffix}@bcom.christuniversity.in`, isCaptain: false },
    ],
    captainPassword: "loadtest12345",
  };
}

async function registerOne(admin, editionId, team) {
  const started = Date.now();
  const captain = team.members.find((m) => m.isCaptain);

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email: captain.christEmail,
    password: team.captainPassword,
    email_confirm: true,
    app_metadata: { role: "team" },
  });
  if (userError || !userData.user) {
    return { ok: false, stage: "createUser", ms: Date.now() - started, error: userError?.message };
  }
  const authUserId = userData.user.id;

  const storagePath = `${authUserId}/invoice.txt`;
  const invoiceBuffer = Buffer.from(`synthetic invoice for load test ${team.teamName}`);
  const { error: uploadError } = await admin.storage
    .from("invoices")
    .upload(storagePath, invoiceBuffer, { contentType: "text/plain", upsert: true });
  if (uploadError) {
    await admin.auth.admin.deleteUser(authUserId);
    return { ok: false, stage: "upload", ms: Date.now() - started, error: uploadError.message };
  }

  const { error: rpcError } = await admin.rpc("register_team", {
    p_auth_user_id: authUserId,
    p_event_edition_id: editionId,
    p_team_name: team.teamName,
    p_campus: team.campus,
    p_members: team.members.map((m) => ({
      full_name: m.fullName,
      class: m.className,
      register_number: m.registerNumber,
      phone: m.phone,
      christ_email: m.christEmail,
      is_captain: m.isCaptain,
    })),
    p_invoice_storage_path: storagePath,
    p_invoice_file_name: "invoice.txt",
    p_invoice_mime_type: "text/plain",
  });
  if (rpcError) {
    await admin.auth.admin.deleteUser(authUserId);
    await admin.storage.from("invoices").remove([storagePath]);
    return { ok: false, stage: "register_team", ms: Date.now() - started, error: rpcError.message };
  }

  return { ok: true, ms: Date.now() - started, authUserId, storagePath };
}

async function main() {
  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const { rows } = await pg.query("select id from public.event_editions where is_active limit 1");
  await pg.end();
  if (!rows[0]) {
    console.error("No active event edition — nothing to load test against.");
    process.exit(1);
  }
  const editionId = rows[0].id;

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Firing ${COUNT} concurrent registrations against edition ${editionId}...`);
  const teams = Array.from({ length: COUNT }, (_, i) => makeTeam(i));
  const startedAll = Date.now();
  const results = await Promise.all(teams.map((t) => registerOne(admin, editionId, t)));
  const totalMs = Date.now() - startedAll;

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const timings = succeeded.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = timings[Math.floor(timings.length * 0.5)] ?? 0;
  const p95 = timings[Math.floor(timings.length * 0.95)] ?? 0;

  console.log(`\nDone in ${totalMs}ms wall-clock.`);
  console.log(`Success: ${succeeded.length}/${COUNT} (${((succeeded.length / COUNT) * 100).toFixed(1)}%)`);
  console.log(`Latency (successful): p50=${p50}ms p95=${p95}ms max=${timings[timings.length - 1] ?? 0}ms`);
  if (failed.length > 0) {
    const byStage = {};
    for (const f of failed) byStage[f.stage] = (byStage[f.stage] ?? 0) + 1;
    console.log(`Failures by stage: ${JSON.stringify(byStage)}`);
    console.log(`Sample failure: ${JSON.stringify(failed[0])}`);
  }

  // Orphan check — every failure must have compensated (no leftover auth
  // user without a team row), matching the action's own guarantee.
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const loadTestUsers = (users?.users ?? []).filter((u) => u.email?.includes(`-${RUN_ID}-`));
  const { data: teamsRows } = await admin.from("teams").select("id").eq("event_edition_id", editionId);
  const teamIdSet = new Set((teamsRows ?? []).map((t) => t.id));
  const orphans = loadTestUsers.filter((u) => !teamIdSet.has(u.id));
  console.log(`Orphaned auth users (created but no team row): ${orphans.length}`);
  if (orphans.length > 0) console.log(orphans.map((u) => u.email));

  console.log("\nRun `npm run unseed:demo` to clean up load-test teams before re-running.");
  process.exit(failed.length > 0 || orphans.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("LOAD TEST FAILED:", e.message);
  process.exit(1);
});
