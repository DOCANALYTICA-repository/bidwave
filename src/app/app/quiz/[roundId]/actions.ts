"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIpKey } from "@/lib/rate-limit";
import { parseRpcErrorCode } from "@/lib/validation/registration";
import { logger } from "@/lib/logger";

// C3: every RPC error here fell back to a generic client message whenever
// it didn't match the `[code] message` convention, with nothing logged —
// the same "opaque error, no server-side trail" shape found in the
// simulation actions. Log the raw message before falling back.
function logUnmappedRpcError(rpc: string, fields: Record<string, unknown>, message: string) {
  logger.error("rpc_error", { rpc, ...fields, message });
}

async function requireTeamUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return user;
}

export async function startQuizAttempt(roundId: string) {
  const user = await requireTeamUser();
  // SEC-10: quiz start is an abuse-prone endpoint like registration/login.
  const ip = await clientIpKey();
  const ok = await checkRateLimit("quiz_start", `${user.id}:${ip}`, 5, 300);
  if (!ok) return { error: "Too many attempts — please wait a few minutes." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("start_quiz_attempt", {
    p_team_id: user.id,
    p_round_id: roundId,
  });
  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    if (!parsed) logUnmappedRpcError("start_quiz_attempt", { team_id: user.id, round_id: roundId }, error.message);
    return { error: parsed?.message ?? "Could not start the quiz." };
  }
  return { data: data as { attempt_id: string; session_token: string } };
}

export async function getQuizStateAction(roundId: string, sessionToken: string) {
  const user = await requireTeamUser();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_quiz_state", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_session_token: sessionToken,
  });
  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    if (!parsed) logUnmappedRpcError("get_quiz_state", { team_id: user.id, round_id: roundId }, error.message);
    return { error: parsed?.message ?? "Could not load quiz state." };
  }
  return { data };
}

export async function saveQuizAnswerAction(
  roundId: string,
  sessionToken: string,
  questionId: string,
  optionId: string,
) {
  const user = await requireTeamUser();
  const admin = createAdminClient();
  const { error } = await admin.rpc("save_quiz_answer", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_session_token: sessionToken,
    p_question_id: questionId,
    p_option_id: optionId,
  });
  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    if (!parsed) logUnmappedRpcError("save_quiz_answer", { team_id: user.id, round_id: roundId, question_id: questionId }, error.message);
    return { error: parsed?.message ?? "Could not save your answer." };
  }
  return { ok: true };
}

export async function submitQuizAttemptAction(roundId: string, reason: string, sessionToken: string) {
  const user = await requireTeamUser();
  // SEC-10: a generous cap above the legitimate case of a few near-
  // simultaneous submit calls (manual click racing the beacon's own exit
  // signals) — this only stops scripted hammering, not normal use.
  const ok = await checkRateLimit("quiz_submit", `${user.id}:${roundId}`, 10, 60);
  if (!ok) return { error: "Too many submit attempts — please wait a moment." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("submit_quiz_attempt", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_reason: reason,
    p_session_token: sessionToken,
  });
  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    if (!parsed) logUnmappedRpcError("submit_quiz_attempt", { team_id: user.id, round_id: roundId }, error.message);
    return { error: parsed?.message ?? "Could not submit the quiz." };
  }

  // Audit high-priority #7: log_quiz_events() existed but was never called
  // from application code, so the admin exit-audit monitor had nothing to
  // show. This records the exit reason that ended the attempt.
  await admin.rpc("log_quiz_events", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_session_token: sessionToken,
    p_events: [{ kind: reason }],
  });

  return { data };
}

/**
 * Report leaving the quiz (tab switch / minimise / navigate away) under the
 * lenient exit policy. The SERVER decides what that costs: a warning, or the
 * end of the attempt once the round's strike limit is reached. The client
 * never makes that call — a client-side counter would reset on the refresh
 * that this policy now deliberately allows.
 */
export async function recordQuizStrikeAction(roundId: string, sessionToken: string, kind: string) {
  const user = await requireTeamUser();
  // Same order of magnitude as quiz_submit: one physical exit can raise two
  // signals, and record_quiz_strike debounces them server-side anyway. This
  // only stops scripted hammering.
  const ok = await checkRateLimit("quiz_strike", `${user.id}:${roundId}`, 30, 60);
  if (!ok) return { error: "Too many requests — please wait a moment." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_quiz_strike", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_session_token: sessionToken,
    p_kind: kind,
  });
  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    if (!parsed)
      logUnmappedRpcError("record_quiz_strike", { team_id: user.id, round_id: roundId, kind }, error.message);
    return { error: parsed?.message ?? "Could not record the event." };
  }
  return { data };
}

/** Dismiss the blocking warning overlay (stamps warning_ack_at). */
export async function ackQuizWarningAction(roundId: string, sessionToken: string) {
  const user = await requireTeamUser();
  const admin = createAdminClient();
  const { error } = await admin.rpc("ack_quiz_warning", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_session_token: sessionToken,
  });
  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    if (!parsed) logUnmappedRpcError("ack_quiz_warning", { team_id: user.id, round_id: roundId }, error.message);
    return { error: parsed?.message ?? "Could not acknowledge the warning." };
  }
  return { ok: true };
}

/**
 * Reclaim an in-progress attempt after a refresh, a crash, or a device
 * swap. Mints a FRESH session token rather than handing the stored one
 * back, so two devices can still never poll the same attempt (AT-QZ-05) —
 * the stale tab gets [session_replaced] on its next poll, which the runner
 * now presents as a real screen with a "continue on this device" button
 * instead of a frozen error.
 */
export async function resumeQuizAttemptAction(roundId: string) {
  const user = await requireTeamUser();
  const ok = await checkRateLimit("quiz_resume", `${user.id}:${roundId}`, 20, 300);
  if (!ok) return { error: "Too many reconnect attempts — please wait a moment." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resume_quiz_attempt", {
    p_team_id: user.id,
    p_round_id: roundId,
  });
  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    if (!parsed) logUnmappedRpcError("resume_quiz_attempt", { team_id: user.id, round_id: roundId }, error.message);
    return { error: parsed?.message ?? "Could not resume your attempt." };
  }
  return { data: data as { status: string; attempt_id: string; session_token?: string } };
}
