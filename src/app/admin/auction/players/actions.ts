"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { parseRpcErrorCode } from "@/lib/validation/registration";

export type PlayerActionState = { status: "idle" | "error" | "success"; formError?: string };

export async function adminUpsertPlayer(
  _prev: PlayerActionState,
  formData: FormData,
): Promise<PlayerActionState> {
  await requireAdmin();

  const playerId = (formData.get("playerId") as string) || null;
  const expectedUpdatedAt = (formData.get("expectedUpdatedAt") as string) || null;
  const eventEditionId = formData.get("eventEditionId") as string;
  const roundId = (formData.get("roundId") as string) || null;
  const fullName = formData.get("fullName") as string;
  const role = formData.get("role") as string;
  const basePrice = Number(formData.get("basePrice") ?? 0);
  const pool = formData.get("pool") as string;
  const nationality = formData.get("nationality") as string;
  const isOverseas = formData.get("isOverseas") === "on";
  const iplTeam = (formData.get("iplTeam") as string) || null;

  let stats: unknown = {};
  try {
    stats = JSON.parse(String(formData.get("stats") ?? "{}"));
  } catch {
    return { status: "error", formError: "Stats must be valid JSON." };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_upsert_player", {
    p_player_id: playerId,
    p_expected_updated_at: expectedUpdatedAt,
    p_event_edition_id: eventEditionId,
    p_round_id: roundId,
    p_full_name: fullName,
    p_role: role,
    p_base_price: basePrice,
    p_pool: pool,
    p_nationality: nationality,
    p_is_overseas: isOverseas,
    p_ipl_team: iplTeam,
    p_stats: stats as never,
  });

  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    return { status: "error", formError: parsed?.message ?? error.message };
  }

  revalidatePath("/admin/auction/players");
  return { status: "success" };
}
