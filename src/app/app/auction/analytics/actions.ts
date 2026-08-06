"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { parseRpcErrorCode, parseRpcErrorDetail } from "@/lib/validation/registration";

export type RequestAnalyticsState = {
  status: "idle" | "error" | "success";
  formError?: string;
  detail?: { balance: number; price: number } | null;
};

async function requireTeamUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return user;
}

export async function requestAnalytics(
  _prev: RequestAnalyticsState,
  _formData: FormData,
): Promise<RequestAnalyticsState> {
  const user = await requireTeamUser();
  const admin = createAdminClient();

  const { error } = await admin.rpc("request_analytics", { p_team_id: user.id });

  if (error) {
    logger.error("rpc_error", { rpc: "request_analytics", team_id: user.id, message: error.message });
    const parsed = parseRpcErrorCode(error.message);
    return {
      status: "error",
      formError: parsed?.message ?? error.message,
      detail: parseRpcErrorDetail<{ balance: number; price: number }>(error.details),
    };
  }

  revalidatePath("/app/auction/analytics");
  return { status: "success" };
}
