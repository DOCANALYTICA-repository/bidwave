"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { parseRpcErrorCode, parseRpcErrorDetail } from "@/lib/validation/registration";
import { AUCTION_BLOCKED_IN_PREVIEW, isAuctionWriteBlocked } from "@/lib/preview-mode";
import { parseCroreInput } from "@/lib/auction/format";

export type TradeActionState = {
  status: "idle" | "error" | "success";
  formError?: string;
  /** Same shape record_sale's [sale_blocked] detail uses — see execute_trade. */
  violations?: { rule: string; [key: string]: unknown }[];
};

/**
 * Zod at the boundary, as everywhere else. Note what it does *not* try to
 * decide: whether the players actually sit on the franchises named, whether the
 * cash exists, or whether the resulting squads are legal. All three are
 * server-authority questions (principle #1) that execute_trade answers against
 * locked rows — repeating any of them here could only ever disagree.
 */
const tradeInputSchema = z
  .object({
    eventEditionId: z.string().uuid(),
    teamAId: z.string().uuid(),
    teamBId: z.string().uuid(),
    playersAToB: z.array(z.string().uuid()).max(50),
    playersBToA: z.array(z.string().uuid()).max(50),
    cashAToB: z.number().nonnegative(),
    cashBToA: z.number().nonnegative(),
    memo: z.string().trim().max(280).optional(),
  })
  .refine((v) => v.teamAId !== v.teamBId, {
    message: "Pick two different franchises.",
  })
  .refine(
    (v) =>
      v.playersAToB.length > 0 || v.playersBToA.length > 0 || v.cashAToB > 0 || v.cashBToA > 0,
    { message: "A trade has to move at least one player or some cash." },
  );

export async function executeTrade(
  _prev: TradeActionState,
  formData: FormData,
): Promise<TradeActionState> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked()) {
    return { status: "error", formError: AUCTION_BLOCKED_IN_PREVIEW };
  }

  // Both cash fields are denominated in crore in the form, like the console's
  // sale amount. An empty field is "no cash", not zero-typed-by-hand, so it
  // parses to 0 rather than failing.
  const cashAToBRaw = String(formData.get("cashAToB") ?? "").trim();
  const cashBToARaw = String(formData.get("cashBToA") ?? "").trim();
  const cashAToB = cashAToBRaw === "" ? 0 : parseCroreInput(cashAToBRaw);
  const cashBToA = cashBToARaw === "" ? 0 : parseCroreInput(cashBToARaw);
  if (cashAToB === null || cashBToA === null) {
    return { status: "error", formError: "Cash must be a plain number of crore, e.g. 1.5 or 0.2." };
  }

  const parsed = tradeInputSchema.safeParse({
    eventEditionId: formData.get("eventEditionId"),
    teamAId: formData.get("teamAId"),
    teamBId: formData.get("teamBId"),
    playersAToB: formData.getAll("playersAToB").map(String),
    playersBToA: formData.getAll("playersBToA").map(String),
    cashAToB,
    cashBToA,
    memo: (formData.get("memo") as string) || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      formError: parsed.error.issues[0]?.message ?? "That trade is not valid.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("execute_trade", {
    p_event_edition_id: parsed.data.eventEditionId,
    p_team_a_id: parsed.data.teamAId,
    p_team_b_id: parsed.data.teamBId,
    p_players_a_to_b: parsed.data.playersAToB,
    p_players_b_to_a: parsed.data.playersBToA,
    p_cash_a_to_b: parsed.data.cashAToB,
    p_cash_b_to_a: parsed.data.cashBToA,
    p_memo: parsed.data.memo ?? null,
    p_admin_id: adminUser.id,
  });

  if (error) {
    const code = parseRpcErrorCode(error.message);
    const details = parseRpcErrorDetail<{ rule: string }[]>(error.details);
    return {
      status: "error",
      formError: code?.message ?? error.message,
      violations: details ?? undefined,
    };
  }

  revalidateTradeSurfaces();
  return { status: "success" };
}

export async function reverseTrade(tradeId: string, reason: string): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked()) return { error: AUCTION_BLOCKED_IN_PREVIEW };

  const admin = createAdminClient();
  const { error } = await admin.rpc("reverse_trade", {
    p_trade_id: tradeId,
    p_reason: reason,
    p_admin_id: adminUser.id,
  });

  revalidateTradeSurfaces();
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

/**
 * A trade changes both franchises' squads and purses, so it invalidates every
 * roster surface — not just this tab. These are the same paths record_sale
 * revalidates plus the tracker and trade block themselves.
 */
function revalidateTradeSurfaces() {
  revalidatePath("/admin/auction/trades");
  revalidatePath("/admin/auction/tracker");
  revalidatePath("/admin/auction/console");
  revalidatePath("/admin/auction/players");
  revalidatePath("/admin/auction/analytics");
  revalidatePath("/app/auction");
  revalidatePath("/live");
}
