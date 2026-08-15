"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { parseRpcErrorCode, parseRpcErrorDetail } from "@/lib/validation/registration";
import { AUCTION_BLOCKED_IN_PREVIEW, isAuctionWriteBlocked } from "@/lib/preview-mode";

export type SaleActionState = {
  status: "idle" | "error" | "success";
  formError?: string;
  violations?: { rule: string; [key: string]: unknown }[];
};

export async function recordSale(
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  const adminUser = await requireAdmin();
  // Preview mode must never produce a sale — see isAuctionWriteBlocked().
  if (await isAuctionWriteBlocked()) {
    return { status: "error", formError: AUCTION_BLOCKED_IN_PREVIEW };
  }
  const admin = createAdminClient();

  const { error } = await admin.rpc("record_sale", {
    p_player_id: formData.get("playerId") as string,
    p_team_id: formData.get("teamId") as string,
    p_amount: Number(formData.get("amount")),
    p_expected_player_updated_at: formData.get("expectedUpdatedAt") as string,
    p_admin_id: adminUser.id,
  });

  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    const details = parseRpcErrorDetail<{ rule: string }[]>(error.details);
    return { status: "error", formError: parsed?.message ?? error.message, violations: details ?? undefined };
  }

  revalidatePath("/admin/auction/console");
  revalidatePath("/live");
  return { status: "success" };
}

export async function reverseSale(
  saleId: string,
  reason: string,
  expectedPlayerUpdatedAt: string,
): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked()) return { error: AUCTION_BLOCKED_IN_PREVIEW };
  const admin = createAdminClient();
  const { error } = await admin.rpc("reverse_sale", {
    p_sale_id: saleId,
    p_reason: reason,
    p_expected_player_updated_at: expectedPlayerUpdatedAt,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/auction/console");
  revalidatePath("/live");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

export async function setActivePlayer(playerId: string, expectedUpdatedAt: string): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked()) return { error: AUCTION_BLOCKED_IN_PREVIEW };
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_active_player", {
    p_player_id: playerId,
    p_expected_updated_at: expectedUpdatedAt,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/auction/console");
  revalidatePath("/live");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

export async function markPlayerUnsold(playerId: string, expectedUpdatedAt: string): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked()) return { error: AUCTION_BLOCKED_IN_PREVIEW };
  const admin = createAdminClient();
  const { error } = await admin.rpc("mark_player_unsold", {
    p_player_id: playerId,
    p_expected_updated_at: expectedUpdatedAt,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/auction/console");
  revalidatePath("/live");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

export async function recallPlayer(
  playerId: string,
  newPool: string | null,
  expectedUpdatedAt: string,
): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked()) return { error: AUCTION_BLOCKED_IN_PREVIEW };
  const admin = createAdminClient();
  const { error } = await admin.rpc("recall_player", {
    p_player_id: playerId,
    p_new_pool: newPool,
    p_expected_updated_at: expectedUpdatedAt,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/auction/console");
  revalidatePath("/live");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

export async function endAuction(eventEditionId: string): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked()) return { error: AUCTION_BLOCKED_IN_PREVIEW };
  const admin = createAdminClient();
  const { error } = await admin.rpc("end_auction", {
    p_event_edition_id: eventEditionId,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/auction/console");
  revalidatePath("/live");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

export async function acquireRecordLock(
  recordType: "player" | "sale",
  recordId: string,
  deviceLabel: string,
): Promise<{ sessionToken?: string; ttlSeconds?: number; error?: string; detail?: unknown }> {
  const user = await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("acquire_record_lock", {
    p_record_type: recordType,
    p_record_id: recordId,
    p_device_label: `${deviceLabel} (${user.email ?? "admin"})`,
    p_admin_id: user.id,
  });
  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    const detail = parseRpcErrorDetail(error.details);
    // console-lock-badge.tsx's only caller checks `result.error === "record_locked"`
    // (the code, not the human message) to decide whether to show the "being
    // edited elsewhere" badge — returning the message here instead of the code
    // meant that check could never match, so the badge silently never appeared
    // for a real lock conflict. Confirmed by direct e2e reproduction.
    return { error: parsed?.code ?? error.message, detail };
  }
  const result = data as { session_token: string; ttl_seconds: number };
  return { sessionToken: result.session_token, ttlSeconds: result.ttl_seconds };
}

export async function heartbeatRecordLock(
  recordType: "player" | "sale",
  recordId: string,
  sessionToken: string,
): Promise<{ error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("heartbeat_record_lock", {
    p_record_type: recordType,
    p_record_id: recordId,
    p_session_token: sessionToken,
  });
  return error ? { error: error.message } : {};
}

export async function releaseRecordLock(
  recordType: "player" | "sale",
  recordId: string,
  sessionToken: string,
): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.rpc("release_record_lock", {
    p_record_type: recordType,
    p_record_id: recordId,
    p_session_token: sessionToken,
  });
}
