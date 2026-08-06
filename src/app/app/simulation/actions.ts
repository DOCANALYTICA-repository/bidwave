"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseRpcErrorCode } from "@/lib/validation/registration";
import { logger } from "@/lib/logger";

async function requireTeamUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return { supabase, user };
}

/** simulation_status() is granted directly to authenticated (documented
 * exception, same shape as can_team_submit) — the regular session client
 * is enough, no admin client needed. */
export async function getSimulationStatusAction(configId: string) {
  const { supabase } = await requireTeamUser();
  const { data, error } = await supabase.rpc("simulation_status", { p_config_id: configId });
  if (error) return { error: error.message };
  return { data };
}

export async function submitSimulationAttemptAction(configId: string, parameters: unknown) {
  const { user } = await requireTeamUser();
  // SEC-10: a backstop above submit_simulation_attempt()'s own
  // submit_cooldown_seconds, which paces legitimate use but isn't an
  // attempt cap — this only stops a script bypassing the cooldown by
  // timing repeated direct calls.
  const ok = await checkRateLimit("simulation_attempt", `${user.id}:${configId}`, 20, 300);
  if (!ok) return { error: "Too many attempts — please wait a few minutes." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("submit_simulation_attempt", {
    p_team_id: user.id,
    p_config_id: configId,
    p_parameters: parameters as never,
  });
  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    // C3: previously discarded silently whenever the error didn't match
    // the `[code] message` convention — any real Postgres error (lock
    // timeout, stale schema cache, unique violation) left no server-side
    // trail at all, just an opaque "Could not submit" for the team.
    if (!parsed) {
      logger.error("rpc_error", { rpc: "submit_simulation_attempt", team_id: user.id, config_id: configId, message: error.message });
    }
    return { error: parsed?.message ?? "Could not submit your combination." };
  }
  return { data };
}
