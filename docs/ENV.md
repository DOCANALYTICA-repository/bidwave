# Environment variables

All variables live in `.env.local` for local development (gitignored — never
commit real credentials). In Vercel, set the same names under Project
Settings → Environment Variables.

| Variable | Where it's used | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + server | The Supabase project's REST/Auth/Realtime endpoint. `NEXT_PUBLIC_*` vars are inlined into the client bundle at build time via static text replacement — always reference this as a literal (`process.env.NEXT_PUBLIC_SUPABASE_URL`), never a computed/bracket lookup, or the client bundle silently gets `undefined` (see `src/lib/supabase/env.ts`'s header comment for the real bug this caused once). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server | The anon/public API key — safe to expose, RLS is the actual boundary. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Bypasses RLS entirely. Used exclusively by `src/lib/supabase/admin.ts`'s `createAdminClient()`, which every mutating Server Action and Route Handler uses to call `service_role`-only RPCs. **Never** expose this to the client or log it. |
| `SUPABASE_DB_URL` | Local tooling only | A direct Postgres connection string (session pooler). Used by: the throwaway migration-apply scripts (see `docs/MIGRATIONS.md`), `tests/helpers/db.ts`'s integration tests, and `scripts/seed-demo.cjs`. Never used by the running app itself — the app always goes through the Supabase client libraries. |

## `.env.local` vs Vercel

- `.env.local` is read by `next dev`/`next build` locally and by every
  Node script in this repo via `dotenv`.
- Vercel's dashboard env vars serve the same role in production/preview
  deploys — set all four there before the first deploy (see
  `docs/DEPLOY.md`).
- `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` should also be added to
  CI secrets if a CI pipeline ever runs `npm run test` or a migration script
  automatically.

## Secrets handling

- Every credential above is capable of full read/write access to the
  database or admin operations — treat `.env.local` like a password file.
- If a throwaway script printed a value from these vars to a terminal by
  accident, treat that terminal history as sensitive.
- Rotating `SUPABASE_SERVICE_ROLE_KEY` invalidates every existing admin
  client instance server-side on next deploy — safe to do at any time, no
  user-facing session is tied to it.
