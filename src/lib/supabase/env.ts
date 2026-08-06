/**
 * Fail fast, not deep inside a request handler, if Supabase env vars are
 * missing. All three client factories (browser/server/admin) go through
 * this so a misconfigured deploy surfaces a clear error immediately.
 *
 * NEXT_PUBLIC_* vars must be referenced as a literal `process.env.FOO` —
 * Turbopack/webpack only inline env vars into the client bundle via static
 * text replacement, so a dynamic `process.env[name]` lookup (the original
 * shape of this helper) always reads `undefined` in the browser. This bug
 * was latent since Phase 0 because no client component had ever actually
 * called the browser Supabase client until Phase 6's realtime hook did.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

export const supabaseUrl = () =>
  required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
export const supabaseAnonKey = () =>
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const supabaseServiceRoleKey = () =>
  required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
