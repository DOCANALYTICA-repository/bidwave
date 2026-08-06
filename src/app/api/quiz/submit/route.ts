import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * QZ-13, ERR-05: `navigator.sendBeacon()` cannot invoke a Server Action —
 * it needs a real Route Handler. The quiz runner's fullscreenchange/
 * visibilitychange/pagehide listeners all hit this same endpoint so
 * whichever exit signal fires first wins; submit_quiz_attempt() is
 * idempotent, so a second beacon racing the first (or the normal "Submit"
 * button) is always a safe no-op.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { roundId?: string; reason?: string; sessionToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { roundId, reason, sessionToken } = body;
  if (!roundId || !reason || !sessionToken) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // SEC-10: same bucket/cap as the manual-submit Server Action — shared so
  // a beacon race plus a manual click count against one combined budget.
  const ok = await checkRateLimit("quiz_submit", `${user.id}:${roundId}`, 10, 60);
  if (!ok) return NextResponse.json({ error: "rate_limited" }, { status: 200 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("submit_quiz_attempt", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_reason: reason,
    p_session_token: sessionToken,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 200 });

  // Audit high-priority #7: log_quiz_events() existed but was never called
  // from application code — this is the "sendBeacon Route Handler" the
  // migration's own comment names as its intended caller.
  await admin.rpc("log_quiz_events", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_session_token: sessionToken,
    p_events: [{ kind: reason }],
  });

  return NextResponse.json({ data });
}
