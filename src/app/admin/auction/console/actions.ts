"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import {
  parseRpcErrorCode,
  parseRpcErrorDetail,
} from "@/lib/validation/registration";
import {
  AUCTION_BLOCKED_IN_PREVIEW,
  isAuctionWriteBlocked,
} from "@/lib/preview-mode";
import { parseCroreInput } from "@/lib/auction/format";
import type { Database } from "@/lib/supabase/types";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];

export type SaleActionState = {
  status: "idle" | "error" | "success";
  formError?: string;
  violations?: { rule: string; [key: string]: unknown }[];
  /**
   * Which player the successful sale was for. The console derives "clear the
   * form and go back to the search" from this rather than resetting state in an
   * effect — see the state block in console-sale-entry.tsx.
   */
  playerId?: string;
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

  // The console field is denominated in crore ("5.5"), record_sale in rupees.
  // Converted here rather than in a hidden mirror input so a stale/absent
  // client-side conversion can never post a wrong rupee figure the server
  // would accept without question.
  const amount = parseCroreInput(String(formData.get("amountCrore") ?? ""));
  if (amount === null) {
    return {
      status: "error",
      formError: "Enter the sale amount in crore, e.g. 5.5 or 0.2.",
    };
  }

  const teamId = formData.get("teamId") as string;
  if (!teamId)
    return {
      status: "error",
      formError: "Pick the franchise the player sold to.",
    };

  const { error } = await admin.rpc("record_sale", {
    p_player_id: formData.get("playerId") as string,
    p_team_id: teamId,
    p_amount: amount,
    p_expected_player_updated_at: formData.get("expectedUpdatedAt") as string,
    p_admin_id: adminUser.id,
  });

  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    const details = parseRpcErrorDetail<{ rule: string }[]>(error.details);
    return {
      status: "error",
      formError: parsed?.message ?? error.message,
      violations: details ?? undefined,
    };
  }

  revalidatePath("/admin/auction/console");
  revalidatePath("/admin/auction/players");
  revalidatePath("/live");
  return { status: "success", playerId: formData.get("playerId") as string };
}

export async function reverseSale(
  saleId: string,
  reason: string,
  expectedPlayerUpdatedAt: string,
): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked())
    return { error: AUCTION_BLOCKED_IN_PREVIEW };
  const admin = createAdminClient();
  const { error } = await admin.rpc("reverse_sale", {
    p_sale_id: saleId,
    p_reason: reason,
    p_expected_player_updated_at: expectedPlayerUpdatedAt,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/auction/console");
  revalidatePath("/live");
  return error
    ? { error: parseRpcErrorCode(error.message)?.message ?? error.message }
    : {};
}

export type ActivateForBiddingResult = {
  error?: string;
  /** The player as the database now holds them — carries the fresh `updated_at`. */
  player?: PlayerRow;
  /** Set when a *different* player was under the hammer and got closed out unsold. */
  displaced?: { id: string; full_name: string };
};

/**
 * Put a player up for bidding in one client round-trip, from whatever state
 * they are in.
 *
 * The console's search offers available, recalled *and* unsold players (an
 * unsold lot coming back round is routine), but `set_active_player` only
 * accepts available|recalled and `players_one_active_per_edition` is a unique
 * index — so "make this player the live one" is really up to three RPCs. Doing
 * them from the client would be three sequential network hops per lot at ~40
 * seconds a lot; the browser only ever waits for this one:
 *
 *   1. close out whoever is currently active (unsold — the room moved on)
 *   2. unsold -> recalled, so the state machine will allow activation
 *   3. available|recalled -> active
 *
 * Each step is still its own audited RPC, so the trail reads exactly as it
 * would have if the admin had clicked through the three buttons by hand. The
 * fresh row comes back because every step bumps `updated_at`, and the next
 * thing the client does is post it to `record_sale` as the optimistic-
 * concurrency token.
 */
export async function activatePlayerForBidding(
  playerId: string,
  expectedUpdatedAt: string,
): Promise<ActivateForBiddingResult> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked())
    return { error: AUCTION_BLOCKED_IN_PREVIEW };
  const admin = createAdminClient();

  const { data: player } = await admin
    .from("players")
    .select("*")
    .eq("id", playerId)
    .maybeSingle();
  if (!player) return { error: "Player not found." };
  if (player.updated_at !== expectedUpdatedAt) {
    return {
      error: "This player changed on another device — refresh and try again.",
    };
  }
  if (player.status === "sold")
    return { error: "That player is already sold." };
  if (player.status === "active") return { player };

  let displaced: { id: string; full_name: string } | undefined;

  const { data: current } = await admin
    .from("players")
    .select("id, full_name, updated_at")
    .eq("event_edition_id", player.event_edition_id)
    .eq("status", "active")
    .maybeSingle();

  if (current && current.id !== playerId) {
    const { error } = await admin.rpc("mark_player_unsold", {
      p_player_id: current.id,
      p_expected_updated_at: current.updated_at,
      p_admin_id: adminUser.id,
    });
    if (error) {
      return {
        error: `${current.full_name} is still up for bidding and could not be closed out: ${
          parseRpcErrorCode(error.message)?.message ?? error.message
        }`,
      };
    }
    displaced = { id: current.id, full_name: current.full_name };
  }

  let expected = player.updated_at;

  if (player.status === "unsold") {
    // Null pool = keep the pool they were listed in; this is the same lot
    // coming back round, not a re-pooling decision.
    const { error } = await admin.rpc("recall_player", {
      p_player_id: playerId,
      p_new_pool: null,
      p_expected_updated_at: expected,
      p_admin_id: adminUser.id,
    });
    if (error)
      return {
        error: parseRpcErrorCode(error.message)?.message ?? error.message,
        displaced,
      };
    const { data: recalled } = await admin
      .from("players")
      .select("updated_at")
      .eq("id", playerId)
      .single();
    expected = recalled?.updated_at ?? expected;
  }

  const { error: activateError } = await admin.rpc("set_active_player", {
    p_player_id: playerId,
    p_expected_updated_at: expected,
    p_admin_id: adminUser.id,
  });
  if (activateError) {
    return {
      error:
        parseRpcErrorCode(activateError.message)?.message ??
        activateError.message,
      displaced,
    };
  }

  const { data: fresh } = await admin
    .from("players")
    .select("*")
    .eq("id", playerId)
    .single();

  revalidatePath("/admin/auction/console");
  revalidatePath("/admin/auction/players");
  revalidatePath("/live");
  return { player: fresh ?? undefined, displaced };
}

export async function markPlayerUnsold(
  playerId: string,
  expectedUpdatedAt: string,
): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked())
    return { error: AUCTION_BLOCKED_IN_PREVIEW };
  const admin = createAdminClient();
  const { error } = await admin.rpc("mark_player_unsold", {
    p_player_id: playerId,
    p_expected_updated_at: expectedUpdatedAt,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/auction/console");
  revalidatePath("/live");
  return error
    ? { error: parseRpcErrorCode(error.message)?.message ?? error.message }
    : {};
}

export async function endAuction(
  eventEditionId: string,
): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  if (await isAuctionWriteBlocked())
    return { error: AUCTION_BLOCKED_IN_PREVIEW };
  const admin = createAdminClient();
  const { error } = await admin.rpc("end_auction", {
    p_event_edition_id: eventEditionId,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/auction/console");
  revalidatePath("/live");
  return error
    ? { error: parseRpcErrorCode(error.message)?.message ?? error.message }
    : {};
}

export async function acquireRecordLock(
  recordType: "player" | "sale",
  recordId: string,
  deviceLabel: string,
): Promise<{
  sessionToken?: string;
  ttlSeconds?: number;
  error?: string;
  detail?: unknown;
}> {
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
