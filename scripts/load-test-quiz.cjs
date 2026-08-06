/**
 * Automated load test for ~400 concurrent quiz-takers (QA item #10).
 *
 * Sets up 400 real teams (via the same register_team chain as
 * load-test-registration.cjs), forces the quiz round open, seeds a
 * throwaway question bank if the current one is empty, then fires
 * start_quiz_attempt -> get_quiz_state -> submit_quiz_attempt for all 400
 * teams concurrently — the same RPCs src/app/app/quiz/[roundId]/actions.ts
 * calls, at roughly the peak concurrency a real 400-team quiz slot would
 * produce (the app's own poll cadence is 2.5s; this fires without that
 * artificial delay to measure the RPCs' own throughput/latency directly).
 *
 * Usage: node scripts/load-test-quiz.cjs [count]
 * Cleanup: npm run unseed:demo (wipes teams + quiz content/attempts for
 * the active edition — see unseed-demo.cjs's own header).
 */
require("dotenv").config({ path: ".env.local" });
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const COUNT = Number(process.argv[2]) || 400;
const RUN_ID = Math.floor(Math.random() * 1e9);

function makeTeam(i) {
  const suffix = `${RUN_ID}-${i}`;
  return {
    teamName: `Quiz Load Team ${suffix}`,
    campus: "Bangalore",
    members: [
      { fullName: `Captain ${suffix}`, className: "BCom", registerNumber: `QREG-C-${suffix}`, phone: "9000000000", christEmail: `qcaptain-${suffix}@bcom.christuniversity.in`, isCaptain: true },
      { fullName: `Member2 ${suffix}`, className: "BCom", registerNumber: `QREG-2-${suffix}`, phone: "9000000001", christEmail: `qmember2-${suffix}@bcom.christuniversity.in`, isCaptain: false },
      { fullName: `Member3 ${suffix}`, className: "BCom", registerNumber: `QREG-3-${suffix}`, phone: "9000000002", christEmail: `qmember3-${suffix}@bcom.christuniversity.in`, isCaptain: false },
    ],
    captainPassword: "loadtest12345",
  };
}

async function registerOne(admin, editionId, team) {
  const captain = team.members.find((m) => m.isCaptain);
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email: captain.christEmail,
    password: team.captainPassword,
    email_confirm: true,
    app_metadata: { role: "team" },
  });
  if (userError || !userData.user) {
    return { ok: false, stage: "createUser", error: userError?.message ?? String(userError), status: userError?.status, code: userError?.code };
  }
  const authUserId = userData.user.id;

  const storagePath = `${authUserId}/invoice.txt`;
  const { error: uploadError } = await admin.storage
    .from("invoices")
    .upload(storagePath, Buffer.from(`synthetic invoice ${team.teamName}`), { contentType: "text/plain", upsert: true });
  if (uploadError) {
    await admin.auth.admin.deleteUser(authUserId);
    return { ok: false, stage: "upload", error: uploadError.message };
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
    return { ok: false, stage: "register_team", error: rpcError.message };
  }
  return { ok: true, teamId: authUserId };
}

async function runQuizFlow(admin, roundId, teamId) {
  const started = Date.now();
  const { data: startData, error: startError } = await admin.rpc("start_quiz_attempt", {
    p_team_id: teamId,
    p_round_id: roundId,
  });
  if (startError) return { ok: false, stage: "start", ms: Date.now() - started, error: startError.message };

  const sessionToken = startData.session_token;

  const { error: stateError } = await admin.rpc("get_quiz_state", {
    p_team_id: teamId,
    p_round_id: roundId,
    p_session_token: sessionToken,
  });
  if (stateError) return { ok: false, stage: "get_state", ms: Date.now() - started, error: stateError.message };

  const { data: submitData, error: submitError } = await admin.rpc("submit_quiz_attempt", {
    p_team_id: teamId,
    p_round_id: roundId,
    p_reason: "completed",
    p_session_token: sessionToken,
  });
  if (submitError) return { ok: false, stage: "submit", ms: Date.now() - started, error: submitError.message };

  return { ok: true, ms: Date.now() - started, result: submitData };
}

async function main() {
  const pg = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const { rows: editionRows } = await pg.query("select id from public.event_editions where is_active limit 1");
  if (!editionRows[0]) {
    console.error("No active event edition.");
    process.exit(1);
  }
  const editionId = editionRows[0].id;

  const { rows: roundRows } = await pg.query(
    "select id, closes_at from public.rounds where event_edition_id = $1 and kind = 'quiz' limit 1",
    [editionId],
  );
  if (!roundRows[0]) {
    console.error("No quiz round found for the active edition.");
    await pg.end();
    process.exit(1);
  }
  const roundId = roundRows[0].id;

  // Force the round open regardless of its scheduled window (mirrors the
  // admin "Open now" button) so this can run pre-event.
  await pg.query(
    "update public.rounds set opened_early_at = now() where id = $1 and closed_at is null",
    [roundId],
  );

  const { rows: qcount } = await pg.query("select count(*) from public.quiz_questions where round_id = $1", [roundId]);
  if (Number(qcount[0].count) === 0) {
    console.log("Question bank empty — seeding 10 throwaway questions for this run.");
    for (let i = 0; i < 10; i++) {
      const { rows: qRows } = await pg.query(
        `insert into public.quiz_questions (round_id, event_edition_id, position, prompt, timer_seconds, weight, is_active)
         values ($1, $2, $3, $4, 20, 1, true) returning id`,
        [roundId, editionId, i, `Load test question ${i}`],
      );
      const questionId = qRows[0].id;
      for (let j = 0; j < 4; j++) {
        await pg.query(
          "insert into public.quiz_options (question_id, position, label, is_correct) values ($1, $2, $3, $4)",
          [questionId, j, `Option ${j}`, j === 0],
        );
      }
    }
  }
  await pg.end();

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Registering ${COUNT} teams for the quiz load test...`);
  const teams = Array.from({ length: COUNT }, (_, i) => makeTeam(i));
  const regResults = await Promise.all(teams.map((t) => registerOne(admin, editionId, t)));
  const registered = regResults.filter((r) => r.ok);
  console.log(`Registered ${registered.length}/${COUNT} teams.`);
  const regFailed = regResults.filter((r) => !r.ok);
  if (regFailed.length > 0) {
    const byStage = {};
    for (const f of regFailed) byStage[f.stage] = (byStage[f.stage] ?? 0) + 1;
    console.log(`Registration failures by stage: ${JSON.stringify(byStage)}`);
    console.log(`Sample: ${JSON.stringify(regFailed[0])}`);
  }

  console.log(`Firing ${registered.length} concurrent quiz flows (start -> get_state -> submit)...`);
  const startedAll = Date.now();
  const results = await Promise.all(registered.map((r) => runQuizFlow(admin, roundId, r.teamId)));
  const totalMs = Date.now() - startedAll;

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const timings = succeeded.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = timings[Math.floor(timings.length * 0.5)] ?? 0;
  const p95 = timings[Math.floor(timings.length * 0.95)] ?? 0;
  const rps = ((succeeded.length * 3) / (totalMs / 1000)).toFixed(1); // 3 RPCs per flow

  console.log(`\nDone in ${totalMs}ms wall-clock for ${registered.length} full flows (~${rps} RPS across start/state/submit).`);
  console.log(`Success: ${succeeded.length}/${registered.length} (${((succeeded.length / registered.length) * 100).toFixed(1)}%)`);
  console.log(`Latency per flow: p50=${p50}ms p95=${p95}ms max=${timings[timings.length - 1] ?? 0}ms`);
  if (failed.length > 0) {
    const byStage = {};
    for (const f of failed) byStage[f.stage] = (byStage[f.stage] ?? 0) + 1;
    console.log(`Failures by stage: ${JSON.stringify(byStage)}`);
    console.log(`Sample failure: ${JSON.stringify(failed[0])}`);
  }

  console.log("\nRun `npm run unseed:demo` to clean up load-test teams/questions before re-running.");
  process.exit(failed.length > 0 || registered.length < COUNT ? 1 : 0);
}

main().catch((e) => {
  console.error("LOAD TEST FAILED:", e.message);
  process.exit(1);
});
