# Deploy

Bidwave deploys as a Next.js app on **Vercel**, backed by a **Supabase**
project (Postgres/Auth/Storage/Realtime).

## 1. Supabase project setup

1. Create a Supabase project (or use the existing one for this event).
   Note its project ref, region, and the session-pooler connection string.
2. Apply every migration under `supabase/migrations/`, in order, against
   this project. If Docker/`supabase db push` is available and working,
   use that. Otherwise follow the throwaway-script workflow in
   `docs/MIGRATIONS.md`.
3. Create the storage buckets referenced by the migrations: `invoices`
   (private), `round-materials`/`submissions` (private) — check each
   migration's `storage.buckets` insert for the exact names and public/
   private flag.
4. Seed the one required `event_editions` row if it isn't already part of
   migration 001 (`is_active = true` for the current event).
5. Collect the project's URL, anon key, and service-role key from
   Project Settings → API.

## 2. Environment variables

Set all four variables from `docs/ENV.md` in Vercel's Project Settings →
Environment Variables, for both Production and Preview environments.

## 3. Vercel project setup

1. Import the repo into Vercel (framework preset: Next.js — auto-detected).
2. Build command / output directory: defaults are correct, no override
   needed.
3. Set the environment variables (§2).
4. Deploy.

## 4. Domain

Point the department's domain (or a Vercel-provided subdomain) at the
Vercel project. No special DNS beyond the standard Vercel CNAME/A record
instructions.

## 5. Post-deploy smoke checklist

Run through this on the live URL before announcing it:

- [ ] `/` loads, hero renders, brand marks load from `/brand/*`.
- [ ] `/register` completes a full test registration end to end (then
      delete the test team via `/admin/teams`).
- [ ] `/login` signs in as the test admin and test team created above.
- [ ] `/admin/teams` shows the test team; `/app` shows the team dashboard.
- [ ] `/live` renders (empty state is fine pre-auction).
- [ ] A Route Handler works: try a small player-import CSV at
      `/admin/auction/players`.
- [ ] `npx vitest run` passes against the **same** Supabase project you
      just deployed against (uses `SUPABASE_DB_URL`, which must point at
      it) — confirms schema/grants are actually correct in production, not
      just in whatever environment they were last verified in.
- [ ] Realtime works: open `/live` in two browser tabs, make one change via
      `/admin/auction/console`, confirm the other tab updates without a
      manual refresh.

Delete all test/QA data created during this checklist before the real event
starts (see the QA-cleanup pattern in `docs/ADMIN_GUIDE.md`).
