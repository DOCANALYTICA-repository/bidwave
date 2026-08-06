# Migrations

Schema is owned entirely by hand-written SQL files in
`supabase/migrations/`, applied in filename (timestamp) order. There is no
ORM and no ORM-managed migration history — every table, RLS policy, RPC,
trigger, and grant is plain SQL, checked into git.

## Why there's no `supabase db reset` locally (usually)

The documented, supported workflow is `npm run db:start` (spins up a local
Supabase/Postgres via Docker) then `npm run db:reset` (replays every
migration from scratch against it). This is the right workflow whenever
Docker is available and working.

During this project's initial build, the development machine's Docker
Desktop VM disk was corrupted, so `supabase start`/`db reset` were
unusable — every migration in the early history was instead applied
directly against a **hosted** Supabase project using the throwaway-script
workflow below. If Docker works on your machine, ignore this section and
use `npm run db:reset` normally.

## The throwaway-script workflow (when Docker isn't available)

For each new migration file:

1. Write the migration as a plain `.sql` file in `supabase/migrations/`,
   named `YYYYMMDDHHMMSS_description.sql` (timestamp must sort after every
   existing migration).
2. Write a throwaway `.apply-migration.cjs` in the repo root (note: `.cjs`,
   not `.mjs` — this package.json has no `"type": "module"`, so a `.mjs`
   scratch file fails with "require is not defined"). It should:
   - `require("dotenv").config({ path: ".env.local" })` explicitly — a bare
     `import "dotenv/config"` silently loads the wrong (nonexistent) `.env`.
   - Connect with the `pg` package using `SUPABASE_DB_URL` and
     `ssl: { rejectUnauthorized: false }`.
   - Wrap the migration SQL in `begin`/`commit`.
   - Also insert a row into `supabase_migrations.schema_migrations` (version,
     name, statements) so the Supabase CLI's own bookkeeping stays
     consistent for whenever `db push`/`db reset` are usable again.
3. Run it: `node .apply-migration.cjs`.
4. **Delete the scratch script immediately after** — never commit it.
5. **Read back grants and RLS** before considering the migration done (see
   below) — this project has repeatedly shipped a migration where something
   silently didn't take effect.
6. **Hand-update `src/lib/supabase/types.ts`** in the same pass — see below.

## The grants gotcha (bitten repeatedly — read this before every migration)

Supabase grants `EXECUTE` on newly-created public-schema functions
**directly** to `anon` and `authenticated` (via its own
`ALTER DEFAULT PRIVILEGES`), not just via `PUBLIC`. `revoke all on function
... from public;` alone does **not** remove that — you must explicitly:

```sql
revoke all on function public.my_function(arg_types) from public, anon, authenticated;
grant execute on function public.my_function(arg_types) to service_role;
```

**Every new RPC needs this exact pair, with no exceptions**, unless it's a
deliberate, documented read-only exception granted directly to
`authenticated` (e.g. `can_team_submit()`, `simulation_status()` — both
self-guarded, no per-team branching). Prefer meeting new read needs through
RLS-visible tables/views instead of adding more such exceptions.

After applying any migration with new functions, verify with a read-only
script:

```js
const fns = await client.query(`
  select p.proname, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('my_function', ...)
`);
```

Confirm `proacl` shows only `postgres` (owner) and `service_role` — never
`anon`/`authenticated` — for any mutating RPC.

## The `citext`/`extensions` schema gotcha

`citext` lives in the `extensions` schema. Plain SQL in a migration resolves
it fine, but any plpgsql function with `set search_path = ''` (correct
`SECURITY DEFINER` hardening — every RPC in this codebase uses this) must
reference it as `extensions.citext` explicitly, or it fails with "type
citext does not exist" at execution time.

## Keeping `src/lib/supabase/types.ts` in sync

This file is normally a regenerated artifact (`npm run db:types`, which
shells out to `supabase gen types typescript --local` against a running
local Postgres). Whenever it's being hand-maintained instead (see the file's
own header comment for whether that's currently the case), update it in the
**same commit** as the migration that changes it — add/modify the
`Tables`/`Views`/`Functions` entries to match the new schema exactly, and
append the new migration's filename to the header's `Covers:` list.

## Migration naming/ordering

`YYYYMMDDHHMMSS_snake_case_description.sql` — the timestamp prefix is the
sole ordering mechanism (both for the Supabase CLI and for the throwaway
apply script). Never reuse or backdate a timestamp.
