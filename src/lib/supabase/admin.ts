import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Service-role client — bypasses RLS entirely. `import "server-only"`
 * makes any accidental client-bundle import a build error, not a runtime
 * leak of the service key.
 *
 * Use ONLY for the narrow set of operations that must cross team
 * boundaries after the caller's own permission has already been checked
 * explicitly in code: minting signed URLs after an authorization check,
 * admin exports, and scheduled/cron-triggered functions that have no
 * end-user session to inherit. Every call site using this client should
 * have a comment explaining why RLS can't do the job.
 *
 * Never use this to "just make an RLS error go away" — that's almost
 * always a sign the policy (or the query) is wrong.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
