"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { parseRpcErrorCode } from "@/lib/validation/registration";

export type RuleSetActionState = { status: "idle" | "error" | "success"; formError?: string };

export async function adminSaveAuctionRuleSet(
  _prev: RuleSetActionState,
  formData: FormData,
): Promise<RuleSetActionState> {
  await requireAdmin();

  const ruleSetId = (formData.get("ruleSetId") as string) || null;
  const expectedUpdatedAt = (formData.get("expectedUpdatedAt") as string) || null;
  const eventEditionId = formData.get("eventEditionId") as string;
  const roundId = (formData.get("roundId") as string) || null;

  let roleLimits: unknown;
  let poolLimits: unknown;
  try {
    roleLimits = JSON.parse(String(formData.get("roleLimits") ?? "{}"));
    poolLimits = JSON.parse(String(formData.get("poolLimits") ?? "{}"));
  } catch {
    return { status: "error", formError: "Role/pool limits must be valid JSON." };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_save_auction_rule_set", {
    p_rule_set_id: ruleSetId,
    p_expected_updated_at: expectedUpdatedAt,
    p_event_edition_id: eventEditionId,
    p_round_id: roundId,
    p_starting_purse: Number(formData.get("startingPurse") ?? 0),
    p_min_squad_size: Number(formData.get("minSquadSize") ?? 0),
    p_max_squad_size: Number(formData.get("maxSquadSize") ?? 0),
    p_max_overseas: Number(formData.get("maxOverseas") ?? 0),
    p_role_limits: roleLimits as never,
    p_pool_limits: poolLimits as never,
    p_analytics_price: Number(formData.get("analyticsPrice") ?? 0),
  });

  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    return { status: "error", formError: parsed?.message ?? error.message };
  }

  revalidatePath("/admin/auction/rules");
  return { status: "success" };
}

export async function adminGrantStartingPurses(eventEditionId: string): Promise<number> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin.rpc("admin_grant_starting_purses", {
    p_event_edition_id: eventEditionId,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/auction/rules");
  return data ?? 0;
}

export async function adminApplyPendingSimulationRewards(): Promise<number> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin.rpc("admin_apply_pending_simulation_rewards");
  revalidatePath("/admin/auction/rules");
  return data ?? 0;
}
