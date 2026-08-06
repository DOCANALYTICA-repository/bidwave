import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * SEC-10: wraps check_rate_limit() (migration 002). Reused by every
 * abuse-prone endpoint this project adds — registration today, quiz
 * submission and simulation attempts in later phases.
 *
 * Best-effort client IP: reliable behind Vercel's proxy in production,
 * less so in arbitrary local setups — that's an accepted limitation for
 * an abuse deterrent, not a hard security boundary (SEC-10 asks to
 * "protect... from abuse", not to make abuse impossible).
 */
export async function clientIpKey(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

export async function checkRateLimit(
  bucket: string,
  key: string,
  maxCount: number,
  windowSeconds: number,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_key: key,
    p_max_count: maxCount,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail open rather than locking out every user because the rate-limit
    // table itself had a transient problem — logged so it's not silent.
    logger.error("rate_limit_check_failed", { bucket, message: error.message });
    return true;
  }
  if (!data) {
    logger.warn("rate_limit_exceeded", { bucket, key, maxCount, windowSeconds });
  }
  return data;
}
