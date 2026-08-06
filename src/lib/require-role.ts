import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * proxy.ts already gates /admin/** by role, but a Server Action is really
 * just a POST endpoint bound to whichever page imported it — a future
 * refactor that reuses one from an ungated route would silently lose that
 * protection. Every admin mutation calls this explicitly too (architecture
 * principle #1: the server is the authority, not the route table).
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "admin") {
    throw new Error("Admin access required.");
  }

  return user;
}
