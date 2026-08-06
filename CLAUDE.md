@AGENTS.md

# Bidwave — Project Context

Bidwave is an IPL-style mock auction event operating system for the Department of Commerce,
CHRIST University (event dates: 17–19 August 2026). It replaces forms/spreadsheets with one
platform: registration, six competition rounds, scoring/qualification, an on-spot simulation,
a live auction console + public tracker, a purse-funded analytics unlock, and final results.

**Authority for behaviour:** `reference/Bidwave_Product_Requirements_Document.docx` (31 sections,
~180 numbered requirements — IDs like `AUC-10`, `SIM-07` are cited throughout the codebase in
comments and migration headers). Landing copy derives from `reference/BIDWAVE brochure (flags).pdf`.
The full implementation plan (phases, schema, architecture principles, decisions made with the
client) lives at `.claude/plans/this-project-is-exclusively-starry-shore.md` — read it before
making architectural changes.

## Non-negotiable architecture principles

1. **Server is the only authority.** Eligibility, deadlines, purse, roster, quiz timers and
   simulation ordering are computed in Postgres. Client clocks are display-only.
2. **Every multi-record mutation is one plpgsql `SECURITY DEFINER` RPC** (`record_sale`,
   `reverse_sale`, `approve_analytics`, `submit_simulation_attempt`, `register_team`, quiz
   lifecycle functions). Never split a business transaction across multiple client round-trips.
3. **Round status is a SQL function of the clock**, not of a cron job's last run. A missed
   `pg_cron` tick must never let a late submission through.
4. **Purse is an append-only ledger** (`purse_ledger`), never a mutable column. Reversals are
   compensating entries — this is what makes "reverse any prior sale" auditable and safe.
5. **Realtime carries no private data.** Triggers append public-safe rows to `live_broadcast`;
   clients refetch private detail through authorized endpoints after a topic ping.
6. **Two visual moods:** *Broadcast* (public/live/auction — high contrast, gold, motion) vs.
   *Console* (submission/admin — calm, dense, minimal motion).

## Stack

Next.js (App Router, currently v16 — see "Next 16 gotchas" below) · React 19 · TypeScript strict ·
Tailwind v4 · shadcn/ui · `motion` (Framer Motion) · Supabase (Postgres/Auth/Storage/Realtime,
schema owned by SQL migrations in `supabase/migrations/`, no ORM) · Zod at every boundary ·
Vitest + Playwright.

## shadcn/ui is on Base UI, not Radix

This scaffold's shadcn components (`src/components/ui/*`) are built on **`@base-ui/react`**,
not Radix — a shadcn.com change, not a project choice. The composition API differs from every
Radix-era shadcn example you may recall:

- No `asChild` prop anywhere. Compose a trigger with a custom element via **`render`**:
  `<DialogTrigger render={<Button variant="outline" />}>Open</DialogTrigger>` — children stay
  as the visible content, `render` supplies the underlying element.
- `TooltipProvider` takes `delay`, not `delayDuration`.
- Data attributes use `data-open`/`data-closed` (not Radix's `data-state="open"`).

This affects Dialog, Sheet, DropdownMenu, Select, Tooltip — anywhere shadcn composes a custom
trigger element. Check the actual component source in `src/components/ui/` when in doubt; don't
pattern-match against pre-Base-UI shadcn examples.

**Nesting a Select/DropdownMenu inside a Dialog/Sheet spuriously closes the outer Dialog too** —
verified by direct reproduction, not a guess. Picking an option unmounts the popup's DOM
synchronously as part of that same click, so by the time the outer Dialog's outside-press check
resolves its event target, the original element (and all its `data-open`/`role="listbox"`
ancestry) is already gone — the target resolves to `document.documentElement` (`<html>`)
instead. `src/components/ui/sheet.tsx` and `dialog.tsx` both guard against this already (see
`isPopupCloseArtifact` in `src/lib/utils.ts`) — any *new* Base UI overlay wrapper that can
contain a nested popup needs the same `onOpenChange` guard, or picking an option inside it will
silently dismiss it.

## Next 16 gotchas (this repo was scaffolded on Next 16, not 15)

- Route guards go in **`src/proxy.ts`** — since this project uses `--src-dir`, it must live
  *inside* `src/` at the same level as `app/`, not at the repo root (the root location silently
  never runs: no error, no log line, requests just pass straight through with no session check).
  Confirmed the hard way — see git history around the Phase 1 auth guards. Exports a `proxy`
  function; `middleware.ts`/`middleware()` are deprecated names for the same mechanism.
- `cookies()`, `headers()`, `draftMode()`, and `params`/`searchParams` in pages/layouts/routes
  are **fully async** — always `await` them, no synchronous fallback exists.
- Turbopack is the default for both `next dev` and `next build`; no `--turbopack` flag needed.
- `next lint` is removed — lint via the ESLint CLI (`npm run lint` already wired to `eslint`).
- Parallel route slots require an explicit `default.js`.
- Use `images.remotePatterns`, not the deprecated `images.domains`.

## Current environment: hosted Supabase, not local — because Docker is broken

This machine's Docker Desktop VM disk is corrupted (its console log at
`~/Library/Containers/com.docker.docker/Data/log/vm/console.log` shows
`EXT4-fs: failed to convert unwritten extents... potential data loss!`,
an aborted journal, and I/O errors on every container write). `docker
info`/`docker ps` hang indefinitely as a result. **Do not spend time
re-diagnosing this** — it needs `Docker Desktop → Troubleshoot → Clean /
Purge data` (or a factory reset) from the user, which nothing in this
repo can trigger.

Consequence: `supabase start` (local Postgres) is unusable, and so is
anything the Supabase CLI implements via a temporary Docker container —
notably `supabase db push` (shells out to `docker image inspect` for a
shadow-DB check even with `--db-url`) and `supabase gen types --db-url`
(spins up `supabase/postgres-meta` via `docker run`). Both hang the same
way `docker ps` does.

**What actually works today**, and is how this project is being developed
until Docker is fixed:
- The app runs against a **hosted Supabase project** (see `.env.local`,
  gitignored, holds its URL + anon + service-role keys).
- Migrations are applied with a plain `pg` connection instead of
  `supabase db push` — see git history around migration 001 for the
  pattern (a throwaway Node script using the `pg` package and the
  session-pooler connection string, wrapped in a transaction, that also
  inserts into `supabase_migrations.schema_migrations` so the CLI's own
  bookkeeping stays consistent for whenever `db push` works again).
- `src/lib/supabase/types.ts` is **hand-written**, not generated — kept in
  exact sync with each migration file. There's a header comment on that
  file with the details; keep updating it by hand until `gen types` has a
  Docker-free path or local dev comes back.

**Once Docker is fixed**, switch back to the documented local workflow
(`npm run db:start`, `npm run db:reset`, `npm run db:types` — the `supabase
gen types typescript --local` variant talks to the already-running local
postgres-meta container, so it doesn't hit this Docker-spin-up issue) and
treat the hosted project purely as staging/production.

## Assets

- `public/brand/` — processed, transparent, ready-to-composite logo cutouts used by the app
  (bidwave-mark, christ-university-mark, doc-commerce-mark, doc-analytica-logo).
- `reference/` — original PRD, brochure PDF, and raw logo exports. **Gitignored** (large
  binaries, not app source) but kept on disk for provenance; do not delete.

## Approved deviations from the PRD (see plan file for full rationale)

- Sponsors section removed from the public site (client-approved).
- Brochure's real IPL franchise flags / trophy artwork are not reproduced anywhere in the UI
  (PRD §24.2 forbids IPL brand assets) — an original broadcast visual language is used instead.
- The on-spot simulation's ~1,000-combination figure (SIM-04) is superseded by the actual
  12-parameter space recovered from the reference Lovable prototype (4⁸ categorical × 4 sliders).
