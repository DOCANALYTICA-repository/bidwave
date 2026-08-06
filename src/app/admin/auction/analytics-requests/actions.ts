"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { logger } from "@/lib/logger";
import { parseRpcErrorCode } from "@/lib/validation/registration";

export async function approveAnalyticsRequest(requestId: string): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("approve_analytics", { p_request_id: requestId, p_admin_id: adminUser.id });
  if (error) logger.error("rpc_error", { rpc: "approve_analytics", request_id: requestId, message: error.message });
  revalidatePath("/admin/auction/analytics-requests");
  revalidatePath("/live");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

export async function rejectAnalyticsRequest(requestId: string, reason: string): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("reject_analytics", {
    p_request_id: requestId,
    p_reason: reason,
    p_admin_id: adminUser.id,
  });
  if (error) logger.error("rpc_error", { rpc: "reject_analytics", request_id: requestId, message: error.message });
  revalidatePath("/admin/auction/analytics-requests");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}

// E4: approval was previously terminal — no way to correct a mistaken
// approval short of manually editing the ledger. Refunds price_charged via
// a compensating purse_ledger entry, mirroring reverse_sale.
export async function revokeAnalyticsApproval(requestId: string, reason: string): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("revoke_analytics_approval", {
    p_request_id: requestId,
    p_reason: reason,
    p_admin_id: adminUser.id,
  });
  if (error) logger.error("rpc_error", { rpc: "revoke_analytics_approval", request_id: requestId, message: error.message });
  revalidatePath("/admin/auction/analytics-requests");
  revalidatePath("/live");
  return error ? { error: parseRpcErrorCode(error.message)?.message ?? error.message } : {};
}
