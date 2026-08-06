"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { parseRpcErrorCode } from "@/lib/validation/registration";
import type { Database } from "@/lib/supabase/types";

export type SimActionState = { status: "idle" | "error" | "success"; formError?: string };

export type SimulationQueryResult = {
  config: Database["public"]["Tables"]["simulation_config"]["Row"] | null;
  attempts: {
    id: string;
    team_id: string;
    team_name: string;
    overall: number;
    success: boolean;
    winner_rank: number | null;
    server_ts: string;
  }[];
  rounds: { id: string; title: string }[];
  teams: { id: string; name: string }[];
  rewards: {
    id: string;
    team_id: string;
    team_name: string;
    reward_kind: "marks" | "purse";
    amount: number;
    target_round_id: string | null;
    purse_applied_at: string | null;
  }[];
};

/** Phase 5: shared by page.tsx's initial fetch and the client's React
 * Query cache (simulation-live.tsx), kept fresh via the 'simulation'
 * broadcast_live() topic instead of a manual nav. */
export async function getSimulationData(eventEditionId: string): Promise<SimulationQueryResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: config } = await supabase
    .from("simulation_config")
    .select("*")
    .eq("event_edition_id", eventEditionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [{ data: attempts }, { data: rounds }, { data: teams }, { data: rewards }] = await Promise.all([
    config
      ? supabase
          .from("simulation_attempts")
          .select("id, team_id, overall, success, winner_rank, server_ts, teams(name)")
          .eq("config_id", config.id)
          .order("server_ts", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("rounds").select("id, title").eq("event_edition_id", eventEditionId).order("sequence"),
    supabase.from("teams").select("id, name").eq("event_edition_id", eventEditionId).order("name"),
    config
      ? supabase
          .from("simulation_rewards")
          .select("id, team_id, reward_kind, amount, target_round_id, purse_applied_at, teams(name)")
          .eq("config_id", config.id)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    config: config ?? null,
    attempts: (attempts ?? []).map((a) => ({
      id: a.id,
      team_id: a.team_id,
      team_name: (a.teams as unknown as { name: string } | null)?.name ?? "—",
      overall: a.overall,
      success: a.success,
      winner_rank: a.winner_rank,
      server_ts: a.server_ts,
    })),
    rounds: rounds ?? [],
    teams: teams ?? [],
    rewards: (rewards ?? []).map((r) => ({
      id: r.id,
      team_id: r.team_id,
      team_name: (r.teams as unknown as { name: string } | null)?.name ?? "—",
      reward_kind: r.reward_kind as "marks" | "purse",
      amount: r.amount,
      target_round_id: r.target_round_id,
      purse_applied_at: r.purse_applied_at,
    })),
  };
}

export async function adminSaveSimulationConfig(
  _prev: SimActionState,
  formData: FormData,
): Promise<SimActionState> {
  await requireAdmin();

  const configId = (formData.get("configId") as string) || null;
  const expectedUpdatedAt = (formData.get("expectedUpdatedAt") as string) || null;
  const globalTimerSeconds = Number(formData.get("globalTimerSeconds") ?? 1500);
  const submitCooldownSeconds = Number(formData.get("submitCooldownSeconds") ?? 3);

  let parameters: unknown;
  let scoring: unknown;
  let answerKey: unknown;
  try {
    parameters = JSON.parse(String(formData.get("parameters") ?? "{}"));
    scoring = JSON.parse(String(formData.get("scoring") ?? "{}"));
    answerKey = JSON.parse(String(formData.get("answerKey") ?? "{}"));
  } catch {
    return { status: "error", formError: "One of the JSON fields is invalid." };
  }

  const admin = createAdminClient();
  const { data: edition } = await admin.from("event_editions").select("id").eq("is_active", true).maybeSingle();
  if (!edition) return { status: "error", formError: "No active event edition found." };

  const { data: round } = await admin.from("rounds").select("id").eq("kind", "simulation").limit(1).maybeSingle();

  const { error } = await admin.rpc("admin_save_simulation_config", {
    p_config_id: configId,
    p_expected_updated_at: expectedUpdatedAt,
    p_event_edition_id: edition.id,
    p_round_id: round?.id ?? null,
    p_parameters: parameters as never,
    p_scoring: scoring as never,
    p_answer_key: answerKey as never,
    p_global_timer_seconds: globalTimerSeconds,
    p_submit_cooldown_seconds: submitCooldownSeconds,
  });

  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    return { status: "error", formError: parsed?.message ?? error.message };
  }

  revalidatePath("/admin/simulation");
  return { status: "success" };
}

export async function adminSetSimulationLifecycle(configId: string, action: string): Promise<{ error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_set_simulation_lifecycle", { p_config_id: configId, p_action: action });
  revalidatePath("/admin/simulation");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

// E2: restarting a stopped simulation is a narrow, audited exception —
// a mandatory reason and admin id, unlike start/stop/reveal/hide above.
export async function adminRestartSimulation(configId: string, reason: string): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_set_simulation_lifecycle", {
    p_config_id: configId,
    p_action: "restart",
    p_admin_id: adminUser.id,
    p_reason: reason,
  });
  revalidatePath("/admin/simulation");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

// E3: undo a marks/purse reward grant — refunds the purse if it had
// already been applied, mirroring reverse_sale.
export async function adminReverseSimulationReward(
  configId: string,
  teamId: string,
  reason: string,
): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("reverse_simulation_reward", {
    p_config_id: configId,
    p_team_id: teamId,
    p_admin_id: adminUser.id,
    p_reason: reason,
  });
  revalidatePath("/admin/simulation");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

export async function adminConfirmSimulationReward(
  configId: string,
  teamId: string,
  attemptId: string | null,
  rewardKind: "marks" | "purse",
  amount: number,
  targetRoundId: string | null,
  reason: string,
): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_confirm_simulation_reward", {
    p_config_id: configId,
    p_team_id: teamId,
    p_attempt_id: attemptId,
    p_reward_kind: rewardKind,
    p_amount: amount,
    p_target_round_id: targetRoundId,
    p_reason: reason,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/simulation");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}
