# Bidwave

An IPL-style mock auction event operating system for the Department of
Commerce, CHRIST University (event dates: 17–19 August 2026). It replaces
forms/spreadsheets with one platform: registration, six competition rounds,
scoring/qualification, an on-spot simulation, a live auction console + public
tracker, a purse-funded analytics unlock, and final results.

## Overview

- **Authority for behaviour**: `reference/Bidwave_Product_Requirements_Document.docx`
  (31 sections, ~180 numbered requirements — IDs like `AUC-10`, `SIM-07` are
  cited throughout the codebase in comments and migration headers). Landing
  copy derives from `reference/BIDWAVE brochure (flags).pdf`. Both are
  gitignored (large binaries) but kept on disk at the repo root under
  `reference/` for provenance.
- **Non-negotiable architecture principles** and the current Docker/Supabase
  development situation are documented in `CLAUDE.md` at the repo root —
  read that first, it's kept current across every session.
- **Design system**: `docs/DESIGN_SYSTEM.md` (+ the live `/dev/kitchen-sink`
  route).
- **Known browser/quiz limitations**: `docs/QUIZ_LIMITATIONS.md`.
- **Migrations workflow**: `docs/MIGRATIONS.md`.
- **Environment variables**: `docs/ENV.md`.
- **Deployment**: `docs/DEPLOY.md`.
- **Running the event**: `docs/ADMIN_GUIDE.md`.
- **Supported browsers**: `docs/BROWSER_SUPPORT.md`.
- **Pre-event rehearsal checklist**: `docs/REHEARSAL_CHECKLIST.md`.

## Tech stack

Next.js (App Router) · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui
(on Base UI, not Radix) · `motion` (Framer Motion) · Supabase
(Postgres/Auth/Storage/Realtime, schema owned by hand-written SQL migrations
in `supabase/migrations/`, no ORM) · Zod at every boundary · Vitest.

## Local setup

1. `npm install`
2. Copy `.env.local.example` (if present) or ask the project owner for
   `.env.local` — it needs `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
   `SUPABASE_DB_URL`. See `docs/ENV.md` for what each is for.
3. `npm run dev` — starts Next.js on `http://localhost:3000`.

**Docker caveat**: if local Docker is available, `npm run db:start` gives you
a full local Supabase stack and `npm run db:reset` replays every migration
against it. If Docker is unavailable on your machine, migrations are applied
directly against the hosted Supabase project instead — see
`docs/MIGRATIONS.md` for that workflow, and `CLAUDE.md` for why this
happened during initial development.

## Running tests

```bash
npm run test
```

Every test under `tests/` opens its own connection to the (hosted or local)
Supabase Postgres instance and calls RPCs directly as the `postgres` role,
wrapped in `begin`/`rollback` — nothing is ever left behind. File-level
parallelism is disabled in `vitest.config.ts` because running test files
concurrently can exceed the hosted session pooler's connection limit.

## Project structure

```
src/app/(public)/    Public marketing site + /live tracker + /leaderboard
src/app/register/    Team registration wizard
src/app/login/       Shared team/admin sign-in
src/app/app/         Team-facing "classroom" (rounds, quiz, simulation, auction, analytics)
src/app/admin/       Admin console (teams, rounds, stages, auction, exports, final results)
src/app/api/         Route Handlers (file uploads, quiz beacon, exports — anywhere a Server Action can't be used)
src/components/      shadcn/ui primitives (ui/) + Bidwave's own component kit (bidwave/)
src/lib/             Supabase clients, validation, rate limiting, logging, realtime
supabase/migrations/ Every schema change, in order, hand-written SQL
tests/               Vitest integration tests against a real Postgres
scripts/             One-off scripts (seed:demo)
docs/                This documentation set
```

## Where to find more context

- The original delivery plan (phases, schema, decisions made with the
  client): `.claude/plans/this-project-is-exclusively-starry-shore.md`.
- The 2026-08-01 external audit + its remediation plan (P0 security fixes,
  data-integrity hardening, workflow repairs — record_sale qualification/
  ended_at guards, admin identity threading, players-stats privacy, round
  materials downloads, announcements, etc.): see the migrations dated
  `20260801*` in `supabase/migrations/` and their in-file comments, each
  tagged with the specific audit finding it addresses.
- Session handoff reports with a running list of real bugs found and fixed:
  `.claude/handoff/`.
