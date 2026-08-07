import "server-only";
import type { SupabaseClient, PostgrestSingleResponse } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Every page/action resolves "the current event edition" through here
 * instead of inlining `.from("event_editions").eq("is_active", true)` —
 * there were ~26 copies of that query scattered across src/app before this.
 *
 * Production semantics are unchanged: is_active, exactly as before.
 * BIDWAVE_EVENT_EDITION_SLUG exists so the e2e suite can point the whole
 * app at a dedicated, non-active test edition — event_editions has a
 * partial unique index on is_active (one active edition, ever), so "just
 * flip is_active for the test edition" is not an option, and the e2e
 * suite's seed/unseed scripts are destructive (they disable the
 * append-only/no-reopen triggers and delete every team, sale, ledger
 * entry, score and submission for their target edition) — pointing that
 * at the live edition is exactly what this override exists to prevent.
 *
 * Ignored outright in production, so a leaked/misconfigured env var can
 * never repoint a real deploy at a different edition.
 */
// The column string is intentionally typed as plain `string`, not fed into
// Supabase's `.select()` overload as a literal: doing that (a generic type
// parameter flowing into `.select()`) blew up `tsc`'s overload resolution
// against the full generated Database type (OOM). The `<T>` here is
// supplied explicitly by the caller instead — same net effect, no
// literal-string inference through Supabase's types.
export async function selectCurrentEdition<T = { id: string }>(
  client: SupabaseClient<Database>,
  columns = "id",
): Promise<PostgrestSingleResponse<T>> {
  const slug = process.env.NODE_ENV !== "production" ? process.env.BIDWAVE_EVENT_EDITION_SLUG : undefined;
  const query = (client.from("event_editions") as any).select(columns); // eslint-disable-line @typescript-eslint/no-explicit-any
  return slug ? query.eq("slug", slug).maybeSingle() : query.eq("is_active", true).maybeSingle();
}
