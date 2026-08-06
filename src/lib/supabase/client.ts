"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Browser-side Supabase client. Subject to RLS as the caller's own role
 * (anon or authenticated team/admin JWT) — never has elevated access.
 * Create one per component tree via a memoized singleton if needed; a
 * fresh instance per call is cheap and avoids stale-closure bugs.
 */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey());
}
