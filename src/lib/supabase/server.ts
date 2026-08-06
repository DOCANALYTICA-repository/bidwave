import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/types";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Server-side Supabase client for Server Components, Server Actions and
 * Route Handlers. Bound to the caller's own session cookie — RLS applies
 * exactly as it would in the browser. This is the client every request
 * handler should reach for by default (architecture principle #1: the
 * server is the authority, but it authorizes as *this specific caller*,
 * not as an admin — use ./admin.ts only for the narrow cases that
 * genuinely need to bypass RLS after an explicit authorization check).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — safe to ignore because
          // proxy.ts refreshes the session cookie on every request.
        }
      },
    },
  });
}
