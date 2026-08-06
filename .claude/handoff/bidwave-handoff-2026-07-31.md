# Bidwave — Project Handoff Report (as of 2026-07-31)

Paste this into a new session to resume the build. It's self-contained: vision,
architecture, exactly what's built through Phase 6, what's left (Phases 7–8),
and every non-obvious gotcha and bug discovered so far — several of which cost
real time to find and must not be re-introduced.

---

## 1. What Bidwave is

Bidwave is an IPL-style mock auction event operating system for the
**Department of Commerce, CHRIST University** (School of Commerce, Finance and
Accountancy). Event dates: **17–19 August 2026**. Tagline from the brochure:
*"Think Fast. Bid Smart. Build Champions."*

It replaces forms/spreadsheets with one platform covering the whole event
lifecycle: public marketing site → team registration → six competition rounds
(quiz, marketing brief, immersive challenge, group discussion, live auction,
conference) → scoring/qualification → an on-spot "weighted-priority
simulation" mini-game → a live auction console + public tracker → a
purse-funded paid analytics unlock → final results.

**Authority for all behavior**: `reference/Bidwave_Product_Requirements_Document.docx`
(31 sections, ~180 numbered requirements — IDs like `REG-06`, `AUC-10`,
`SIM-07` are cited in migration headers and code comments throughout; treat
them as ground truth). Landing copy derives from
`reference/BIDWAVE brochure (flags).pdf`. Both are gitignored (large
binaries) but present on disk at the project root under `reference/`.

**The full original implementation plan** (phases, schema, architecture
principles, decisions made with the client) lives at
`.claude/plans/this-project-is-exclusively-starry-shore.md` — read this file
in full before making any architectural decision it doesn't already cover.
A second plan, `.claude/plans/private-tmp-claude-501-users-shiva-1-de-cheerful-stroustrup.md`,
has the detailed design for Phases 3–5 (schema rationale, RPC signatures, the
quiz timing-model comparison, the simulation rubric design). A third plan,
`.claude/plans/read-bidwave-claude-handoff-bidwave-hand-lexical-turing.md`,
has the detailed design actually executed for **this session's** Phase 2 +
Phase 6 build (exact migration SQL, RPC signatures, milestone breakdown) —
read this one if you need to understand *why* a specific auction schema/RPC
decision was made.

### Non-negotiable architecture principles (still binding, unchanged since Phase 0)

1. **Server is the only authority.** Eligibility, deadlines, purse, roster,
   quiz timers and simulation ordering are computed in Postgres. Client
   clocks are display-only (SEC-06, QZ-16, SIM-08).
2. **Every multi-record mutation is one plpgsql `SECURITY DEFINER` RPC**,
   granted to `service_role` only, called exclusively from trusted Next.js
   server code (Server Actions or a Route Handler). Never split a business
   transaction across multiple client round-trips.
3. **Round status is a SQL function of the clock**, not a cron job's last
   run. A missed `pg_cron` tick must never let a late submission through.
   `is_registration_open()` (Phase 1), `effective_round_status()` (Phase 3),
   the quiz's lockstep schedule (Phase 4), and the simulation's
   start/stop timestamps (Phase 5) all follow this pattern.
4. **Purse is an append-only ledger**, never a mutable column
   (`purse_ledger`, built in Phase 6). Reversals are compensating entries —
   this is what makes "reverse any prior sale" auditable and safe.
5. **Realtime carries no private data.** Triggers append public-safe rows to
   `live_broadcast(topic, kind, payload)` (built in Phase 6); clients
   subscribe by topic and refetch private detail through authorized
   endpoints (or, since almost none of the auction's data is actually
   private, simply refetch the public view directly).
6. **Two visual moods:** *Broadcast* (public/live/auction — high contrast,
   gold, motion) vs. *Console* (submission/admin — calm, dense, minimal
   motion). Reflected throughout the design system and the auction console.

### Approved deviations from the PRD (client-approved, don't "fix" these)

- Sponsors section removed from the public site entirely.
- The brochure's real IPL franchise flags / trophy artwork must **never**
  appear anywhere in the UI (PRD §24.2 forbids IPL brand assets) — an
  original broadcast visual language is used instead.
- The on-spot simulation's PRD figure of "~1,000 combinations" (SIM-04) is
  superseded by the actual 12-parameter space recovered from the reference
  Lovable prototype (`4⁸` categorical × 4 sliders).
- **Phase 2 (this session)**: the public site uses separate top-level routes
  (`/`, `/rounds`, `/schedule`, `/prizes`, `/faqs`, `/leaderboard`, `/live`)
  rather than a single scrolling anchor page, navigated via a persistent
  shared layout (Next.js route group) for an SPA feel — an explicit choice
  by the user over the plan's original single-page sketch.
- **Phase 2**: the brochure PDF is committed directly to `public/` (~22MB)
  rather than hosted in Supabase Storage — simplest option, accepted
  repo-size tradeoff, swapping it later needs a new commit + redeploy.

---

## 2. Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict ·
Tailwind v4 · shadcn/ui (**on Base UI, not Radix** — see gotchas) · `motion`
(Framer Motion) · Supabase (Postgres/Auth/Storage/Realtime, schema owned
entirely by hand-written SQL migrations, no ORM) · Zod at every boundary ·
`papaparse` + `exceljs` (CSV/XLSX player import, added this session) ·
Vitest (integration tests run against the hosted DB — see §7; Playwright
still not wired up).

## 3. Current environment — READ THIS FIRST

**Docker Desktop's VM disk is corrupted** on the development machine
(confirmed via its own console log: `EXT4-fs: failed to convert unwritten
extents... potential data loss!`, aborted journal, I/O errors on every
write). `docker info`/`docker ps`/`docker run` all hang indefinitely.
Consequence: `supabase start` (local Postgres) is unusable, and so is
anything the Supabase CLI does via a temporary Docker container. **Do not
spend time re-diagnosing this** — check whether the user has since run
Docker Desktop's "Troubleshoot → Clean/Purge data" before assuming it's
still broken; nothing in this repo can fix it.

**What actually works, and how this project is being built until Docker is
fixed:**
- The app runs against a **hosted Supabase project** (`hkbpklqkpdspwqrwssdo`,
  region ap-south-1). Credentials are in `.env.local` (gitignored). Ask the
  user for the session-pooler connection string if it's ever needed and
  missing; store as `SUPABASE_DB_URL` in `.env.local`.
- **Migrations are applied with a plain `pg` connection**, not
  `supabase db push`. Pattern: write a throwaway `.apply-migration.cjs` in
  the project root (note: `.cjs`, not `.mjs` — this package.json has no
  `"type": "module"`, so a `.mjs` scratch file fails with "require is not
  defined"), using the `pg` package and `SUPABASE_DB_URL`
  (`ssl: { rejectUnauthorized: false }`), wrapped in `begin`/`commit`, that
  also inserts into `supabase_migrations.schema_migrations` so the CLI's own
  bookkeeping stays consistent. **Delete the scratch script after each use**
  — never commit it. dotenv must be pointed at `.env.local` explicitly
  (`require("dotenv").config({ path: ".env.local" })`); a bare
  `import "dotenv/config"` silently loads the wrong (nonexistent) `.env`.
- **After every migration, read back grants/RLS with a small script** — this
  project has repeatedly shipped a migration where something silently didn't
  take effect (see §5). Query `pg_proc.proacl` for every new function and
  `pg_class.relrowsecurity` for every new table before considering a
  migration done.
- **`src/lib/supabase/types.ts` is hand-written**, not generated. Kept in
  exact sync with every migration file, by hand. The header comment has a
  running `Covers:` list of every migration it's been kept in sync with —
  currently through `20260730081000_record_locks_nullable_locked_by.sql`.
  Update that list every time.
- Once Docker is fixed, switch back to `npm run db:start` / `npm run
  db:reset` / `npm run db:types` and treat the hosted project as
  staging/production only.

**Grants gotcha (bitten repeatedly across every phase so far):** Supabase
grants `EXECUTE` on newly-created public-schema functions **directly** to
`anon` and `authenticated` (via its own `ALTER DEFAULT PRIVILEGES`), not just
via `PUBLIC`. `revoke all on function ... from public;` alone does **not**
remove that — you must explicitly
`revoke ... from public, anon, authenticated;` and grant only to
`service_role`, or every mutation RPC is silently callable directly from the
browser. **Every new RPC needs an explicit revoke+grant line, with no
exceptions.** Documented, deliberate exceptions granted directly to
`authenticated` (read-only, self-guarded, no per-team branching):
`can_team_submit()`, `simulation_status()`. Phase 6 added **zero** new such
exceptions — every read need is instead met by RLS-visible tables/views
(`players`, `auction_state`, `public_team_purses`, `public_sales_feed`,
`live_broadcast` are all legitimately public data).

**`citext`/`extensions` schema gotcha:** `citext` lives in the `extensions`
schema. Plain SQL in a migration resolves it fine, but any plpgsql function
with `set search_path = ''` (correct `SECURITY DEFINER` hardening) must
reference it as `extensions.citext` explicitly, or it fails with "type
citext does not exist" at execution time.

**Next.js `"use server"` gotcha:** a `"use server"` file can **only export
async functions** (plus type exports). Exporting a plain object/constant
(e.g. an `initialState` literal for `useActionState`) throws a **runtime**
error that `tsc`/`eslint` do not catch. Fix: define the initial-state
constant in the **client** component that calls `useActionState`, never in
the actions file. **Grep `export {.*[Ii]nitial` in any new `"use server"`
file before considering it done** — verified clean across every actions file
in the repo as of this session, including all new Phase 6 ones.

---

## 4. What's built — Phases 0–6, all verified live

### Phase 0 — Foundation ✅
Next.js 16 scaffold, Tailwind v4 + shadcn/ui (Base UI) + `motion` + Zod +
Vitest. Dark-only design system sampled from the BidWave logo (full token
list in `docs/DESIGN_SYSTEM.md`; key tokens `--gold #EEC34B`,
`--surface-0..4`, `--sold`/`--unsold`/`--live`, `--analytics #00AFF0`). Five
fonts via `next/font/google` (Anton, League Spartan, Arapey, Inter,
JetBrains Mono). Brand marks in `public/brand/*.png`, used via
`<BrandMark name="..." height={n} />` from `@/components/bidwave` — never
reference `reference/Logos/*` from app code. Component kit
(`src/components/bidwave/`): `BrandMark`, `StatusPill` (single source of
truth for every status word via `STATUS_TONES` — **already had entries for
auction/analytics states from Phase 0**, scaffolded ahead of Phase 6/7:
`available/active/sold/unsold/recalled` and
`locked/requested/purchased/rejected`), `StatTile`, `Money`/`MoneyDelta`,
`Countdown`, `FileDrop`, `EmptyState`, `ReconnectBanner`
(+`useBrowserConnectionStatus`), `DataTable`. Migration 001
(`20260729115900_init_foundation.sql`): extensions (`pgcrypto`, `citext`,
`pg_cron`), `public.is_admin()`, `set_updated_at()` trigger fn,
`event_editions` (seeded "Bidwave 2026"), `settings` (admin-editable
key/value store, seeded with placeholder `whatsapp_link`,
`registration_fee`, `payment_instructions`, `prizes`, `faqs`, `contacts`,
`instagram_url`).

### Phase 1 — Auth, registration, teams ✅
Migration 002 (`20260729153617_teams_and_registration.sql`):
`is_registration_open()`, `teams` (id **is** the team's single
`auth.users` id — one shared account per team forever), `team_members`
(3–4 per team), `invoices`, `activity_events`, `rate_limit_buckets` +
`check_rate_limit()`, `register_team()` RPC, `admin_update_team()` RPC
(optimistic concurrency via `p_expected_updated_at`). Private `invoices`
storage bucket. `/register` 5-step wizard, `/register/success`, `/login`
(role resolved from JWT `app_metadata`), `/app` (classroom dashboard),
`/admin/teams`. `src/proxy.ts` role-based route guards (must live at
`src/proxy.ts`, not repo root — silently never runs otherwise). 19 passing
Vitest unit tests on registration validation.

### Phase 3 — Round engine, submissions, scoring, qualification, leaderboards ✅
Migration `20260730040000_rounds_scoring_leaderboards.sql`. Tables:
`stages`, `rounds` (kind: quiz/submission/offline_info/simulation/auction/
conference; admin override is two **one-way** timestamps
`opened_early_at`/`closed_at`), `stage_rounds`, `round_materials`,
`submissions`, `submission_files`, `rubric_criteria`, `scores` (`source`
column — `'manual'|'quiz'|'simulation'`), `score_criterion_values`,
`stage_adjustments`, `qualifications`, `leaderboard_snapshots` +
`leaderboard_snapshot_entries` (append-only), `announcements`. Private
`submissions` storage bucket. Key functions:
`effective_round_status(rounds)`, `rounds_with_status` view
(`security_invoker = true`), `can_team_submit()`, `submit_round_files()`,
`admin_upsert_round()`, `admin_set_round_lifecycle()`,
`admin_upsert_round_material()`, `admin_upsert_rubric_criterion()`,
`admin_save_score()`, `admin_publish_scores_for_round()`,
`stage_standings()`, `admin_confirm_qualifications()`,
`admin_publish_leaderboard()`, `admin_hide_leaderboard()`,
`admin_upsert_announcement()`. One `pg_cron` job
(`materialize-round-status`).

### Phase 4 — Round 1 quiz engine ✅
Migration `20260730050000_quiz_engine.sql`. **Lockstep schedule** timing
model (question *k*'s window is a pure function of `started_at` + the sum
of prior timers — no "Next" button, no `advance_quiz_question` RPC exists at
all). Tables: `quiz_questions`, `quiz_options` (admin-only select under
RLS), `quiz_attempts` (materialised schedule snapshot, partial unique index
for "one continuous attempt"), `quiz_answers`, `quiz_events`. Key functions:
`quiz_current_index()`, `start_quiz_attempt()`, `get_quiz_state()`,
`save_quiz_answer()`, `submit_quiz_attempt()` (idempotent, release-gated),
`tick_quiz_attempts()` (`pg_cron` backstop), `admin_reset_quiz_attempt()`.
`/app/quiz/[roundId]` runner with fullscreen + exit detection via
`sendBeacon` to `/api/quiz/submit`. `docs/QUIZ_LIMITATIONS.md`.

### Phase 5 — On-spot weighted-priority simulation ✅
Migration `20260730060000_simulation.sql`. Graded partial credit + tolerance
-band slider matching; all-defaults evaluates to exactly 70 (enforced by a
table CHECK constraint). Tables: `simulation_config` (three trust-scoped
jsonb columns, `answer_key` service_role-only), `simulation_attempts`
(partial unique index on `(config_id, winner_rank) where winner_rank is not
null` + row lock → race-safe "exactly two winners"), `simulation_rewards`
(**`purse_ledger_entry_id uuid` with no FK yet** at the time — Phase 6's job
to validate it). `/app/simulation` 12-section console, `/admin/simulation`.

### Phase 2 — Public site ✅ (this session)
Full landing page + separate top-level routes (confirmed with the user:
**not** a single-page scroll — SPA-style navigation via a persistent shared
layout).

- **`src/app/(public)/layout.tsx`** — new route group; `SiteHeader` +
  `{children}` + `SiteFooter` persist across every public route (Next.js
  doesn't remount a shared layout between sibling routes under it — this is
  what gives the "no refresh" feel with plain `next/link`, no custom
  router).
- **`src/lib/supabase/settings.ts`** — new `getSettings(keys)` helper, Zod
  schema per settings key, degrades to "key absent" on a malformed value.
- **`src/lib/rounds-catalog.ts`** — static `ROUND_COPY` for the six
  brochure rounds (The Stat Sprint, Operation Fan Heist, The Immersive
  Challenge, Crisis Room, The Grand Auction, The Owners' Summit) —
  deliberately independent of the `rounds` DB table (that holds the admin's
  private working draft).
- **`src/components/marketing/*`** — `site-header.tsx` (client, active-route
  highlight, mobile `Sheet` menu), `site-footer.tsx` (three-logo row + DOC
  Analytica credit + contacts + Instagram + brochure link), `hero.tsx`,
  `about-section.tsx`, `guidelines-section.tsx`, `round-card.tsx`,
  `rounds-teaser.tsx`, `schedule-section.tsx`, `prizes-section.tsx`,
  `faq-accordion.tsx` (new shadcn `ui/accordion.tsx`, added via
  `npx shadcn add accordion`), `registration-cta-section.tsx`,
  `brochure-download-link.tsx`.
- Routes: `/` (replaces the old placeholder), `/rounds` (full grid),
  `/rounds/[slug]` (static brochure copy always shown + RLS-gated
  `round_materials` once actually released — **fixed a real signed-URL gap**
  here, see §5), `/schedule`, `/prizes`, `/faqs`, `/leaderboard` (moved into
  the route group, restyled, **added the previously-missing `final_top_10`
  query** — it only ever fetched `top_15` before), `/live` (pre-Phase-6
  shell at first, fully replaced in Phase 6 — see below).
- `public/bidwave-brochure.pdf` committed (only `reference/` is gitignored,
  `public/` isn't).
- New migration `20260730070000_seed_six_rounds.sql` — seeds the six real
  `rounds` rows (slugs match `ROUND_COPY` exactly) so `/rounds/[slug]` isn't
  permanently empty.
- Full browser verification across desktop/tablet/mobile, dark theme,
  reduced motion, accordion keyboard nav, mobile nav sheet.

### Phase 6 — Auction ✅ (this session)
New migration `20260730080000_auction.sql` (+ a tiny corrective migration
`20260730081000_record_locks_nullable_locked_by.sql`, see §5). Full design
rationale in `.claude/plans/read-bidwave-claude-handoff-bidwave-hand-lexical-turing.md`.

**Schema**: `player_stat_definitions` (extensible metrics, AUC-07),
`players` (§21.3 state machine: `available → active → sold|unsold →
recalled`, one-active-per-edition via partial unique index, fully public
RLS), `auction_rule_sets` (starting purse, squad/overseas/role/pool limits,
analytics price — all DEP-06/07 placeholders, one active per edition),
`purse_ledger` (**genuinely append-only** — a `before update or delete`
trigger raises unconditionally, *and* no UPDATE/DELETE grant to any role —
belt-and-suspenders since a `SECURITY DEFINER` function runs as its owner
and table grants alone wouldn't stop it; `entry_kind` already includes
`'analytics'` so Phase 7 needs zero further ledger migrations),
`team_purse_balances` view (balance always derived, never stored),
`auction_state` (singleton per edition — `active_player_id`, `ended_at`),
`record_locks` (advisory-only concurrency indicator for AUC-13–16 — **does
not** gate the RPCs themselves, see the design note below), `auction_sales`,
`auction_audit_events` (admin-only, the rich internal audit trail),
`live_broadcast` (+ `broadcast_live()`, added to the `supabase_realtime`
publication), `public_team_purses` / `public_sales_feed` (curated public
views, deliberately **not** `security_invoker` — the goal is bypassing
base-table RLS for column curation, the opposite of `rounds_with_status`).
Validated Phase 5's forward reference: `simulation_rewards.purse_ledger_entry_id`
now has a real FK.

**Concurrency design (AUC-13–16, genuinely new ground)**: `record_locks` is
**advisory only** — it warns the admin UI ("being edited on Console B") but
the actual race-safety guarantee is the row lock + `p_expected_updated_at`
staleness check inside `record_sale`/`reverse_sale` themselves, which apply
regardless of whether a soft lock was ever acquired (a crashed tab that
never releases its lock must never block a legitimate sale). AUC-13's
"shared admin account, multiple devices" means `auth.uid()` can never
distinguish device A from B (there's exactly one admin `auth.users` row) —
per-device identity comes from a client-generated `device_label` +
`session_token` instead.

**RPCs** (every one lock-ordered player-row-then-team-row, so no two
auction functions can ever deadlock against each other): `record_sale`
(validates purse/squad/role/overseas/pool, returns **every** violated rule
via the exception's structured `DETAIL`, not just the first — see
`parseRpcErrorDetail()` below), `reverse_sale` (takes a specific
`p_sale_id`, not "reverse latest" — this is what makes AUC-17 concrete;
`[already_reversed]` on double-invoke is a genuine error, not a silent
no-op, unlike `submit_quiz_attempt`'s idempotent design), `set_active_player`,
`mark_player_unsold`, `recall_player`, `end_auction` (idempotent),
`admin_import_players` (deliberately partial-success per row — the *one*
place in this codebase where "zero partial writes" is intentionally not the
contract, since AUC-05 wants exactly that), `admin_upsert_player` (no delete
RPC — deleting a player with sale history would destroy the audit trail),
`admin_save_auction_rule_set`, `admin_grant_starting_purses` (idempotent
top-up via a partial-unique-index-targeted `on conflict`),
`admin_apply_pending_simulation_rewards` (consumes Phase 5's
`pending_simulation_purse_awards` view, also a `pg_cron` job running every
minute), `acquire_record_lock`/`heartbeat_record_lock`/`release_record_lock`.

**`parseRpcErrorDetail()`** — new sibling to the existing
`parseRpcErrorCode()` in `src/lib/validation/registration.ts`, parses the
JSON array a function attaches via `raise ... using detail = ...` (Postgres
exceptions carry `MESSAGE` and `DETAIL` separately; PostgREST exposes both
as `.message`/`.details`).

**CSV/XLSX import**: `papaparse` + `exceljs` added as dependencies. Parsing
happens in a Route Handler (`src/app/api/admin/auction/import-players/route.ts`,
`runtime = "nodejs"` — `exceljs` needs real Node Buffers), not a Server
Action, mirroring the existing `/api/quiz/submit` file-upload precedent.
`src/lib/validation/auction.ts` — `playerImportRowSchema`,
`IMPORT_COLUMN_ALIASES` (unmapped headers auto-become `stats` keys, the
AUC-07 extensibility mechanism), `parseImportRow()`.

**Admin UI**: `/admin/auction/players` (import form + table + add/edit
sheet), `/admin/auction/rules` (numeric inputs + JSON textareas for
role/pool limits, "Grant starting purses" / "Apply pending simulation
rewards" buttons), `/admin/auction/console` (active-player card + sale-entry
form — **one button, no confirmation dialog**, per §24.4's "no friction on
routine sale entry" — + sales log with a **required-reason reversal
dialog**, the one deliberate friction point matching §24.4's other clause),
`/admin/auction/analytics` (admin's own operational StatTiles — sold/unsold/
available/recalled counts, purse-remaining bars, recent audit events —
fully in Phase 6 scope, distinct from the team-facing locked stub),
`/admin/auction/layout.tsx` (sub-nav), "Auction" link added to
`/admin/layout.tsx`'s sidebar.

**Public/team UI**: `/live` (fully replaced the Phase 2 shell — branches on
`auction_state.ended_at`: live mode shows an active-player hero + pool tabs
+ sales feed + team purse/roster cards with an unconditionally-locked
analytics badge (satisfies LIVE-07 by construction, since Phase 6 ships no
`analytics_requests` table at all); ended mode shows a calmer final-squad
summary, LIVE-08), `/app/auction` (team's own roster, purse + full
transaction ledger via `MoneyDelta`, role/overseas/pool compliance panel —
**zero bid/control UI anywhere**, TEAM-AUC-05/§29, enforced simply by never
importing a mutating action into this file), `/app/auction/analytics`
(static locked stub, `// TODO Phase 7` marker), `/app`'s round card now
deep-links `kind='auction'` rounds to `/app/auction` instead of the generic
`/app/rounds/[id]`.

**Realtime**: `src/lib/realtime/use-live-broadcast.ts` — subscribes to
`postgres_changes` INSERT on `live_broadcast` for one topic, maps channel
status to `ReconnectBanner`'s `online`/`reconnecting`/`offline`. Every
consumer's `onEvent` does a **full refetch** (`router.refresh()`), never
incremental patching — fires once on mount/reconnect plus a 15s
reconciliation poll as a backstop (principle #3 applied to realtime).

**Tests**: `tests/auction.test.ts` (new), + new helpers in
`tests/helpers/db.ts` (`createTestPlayer`, `createTestAuctionRuleSet`,
`grantTestPurse`). Covers AT-AUC-01 (valid sale, one call updates
everything), AT-AUC-02 (insufficient purse, zero partial writes),
AT-AUC-03 (overseas-cap violation), AT-AUC-04 (reversal restores state for
a *non-latest* sale; rejects double-reversal), AT-AUC-05 (same-player
contention — exactly one call wins; different-player sale+reversal doesn't
deadlock), record-lock protocol (acquire/block/release/re-acquire), player
import partial-success, purse-ledger append-only enforcement,
`admin_apply_pending_simulation_rewards` idempotency.
**40/40 tests pass** (29 pre-existing + 11 new).

**Explicitly out of scope for Phase 6** (per TEAM-AUC-05/§29 and the Phase 7
boundary): no bid-entry/raise-bid UI anywhere under `/app/**`; no
`approve_analytics()` RPC, no `analytics_requests` table, no price-charging
flow (`purse_ledger.entry_kind` already includes `'analytics'` so Phase 7
needs no further ledger migration); no real player data/rule-set
numbers/analytics price (DEP-05/06/07 still pending from the client — every
value ships as an admin-editable placeholder).

---

## 5. Real bugs found and fixed this session — read before writing similar code

All of these were invisible to `tsc`/`eslint`/`vitest` alone; every one was
only caught by actually driving the app in a browser or querying Postgres
system catalogs directly. **This project's pattern continues to hold: do
not skip live browser verification, and do not skip a grants/RLS readback
after a migration.**

1. **`src/lib/supabase/env.ts` used `process.env[name]` (a dynamic,
   computed member expression)** instead of a literal `process.env.NEXT_PUBLIC_X`
   reference. Turbopack/webpack only inline `NEXT_PUBLIC_*` vars into the
   client bundle via **static text replacement** — a dynamic bracket lookup
   is invisible to that analysis and reads `undefined` in the browser. This
   bug was **latent since Phase 0** because no client component had ever
   actually called the browser Supabase client (`src/lib/supabase/client.ts`)
   until this session's realtime hook did. Fixed by rewriting
   `supabaseUrl()`/`supabaseAnonKey()`/`supabaseServiceRoleKey()` to
   reference `process.env.NEXT_PUBLIC_SUPABASE_URL` etc. as literals. **If
   you add a new env-var helper, always use the literal form for anything
   that might run client-side.**
2. **`record_locks.locked_by uuid not null references auth.users`** — but
   `auth.uid()` is **always null** for any RPC invoked via the service-role
   admin client (it carries a `service_role` JWT claim with no `sub`/user
   id). This is a **pre-existing, already-shipped gap across the whole
   codebase** (confirmed the same is true of `admin_save_score`'s
   `entered_by`, `stage_adjustments.created_by`, etc. — all silently null in
   production, always, for every admin-attributed column, since every
   Server Action calls `requireAdmin()` and then reaches for
   `createAdminClient()`, discarding the real user it just fetched). For
   most tables this is just a quiet audit gap (the column is nullable). For
   `record_locks.locked_by` it was `NOT NULL`, turning the same gap into a
   **hard crash on every single lock acquisition**. Fixed with a corrective
   migration (`alter table record_locks alter column locked_by drop not
   null`) rather than trying to fix the systemic actor-attribution gap
   project-wide (out of scope, and the rest of the codebase already
   tolerates it). **If a future phase needs real actor attribution, the fix
   is to have the Server Action pass the real `user.id` from
   `requireAdmin()`'s return value as an explicit RPC parameter — `auth.uid()`
   inside any RPC called via the admin client will never work.**
3. **`auction_state.active_player_id` was never cleared** by `record_sale`
   or `mark_player_unsold` when the pointed-to player left `'active'`
   status — so both the admin console and the public `/live` tracker kept
   showing an already-sold player as "on the block." Fixed at the
   query/page level (not a migration) in both `admin/auction/console/page.tsx`
   and `(public)/live/page.tsx`: only trust `auction_state.active_player_id`
   as "the active player" when that player's own `status` column still says
   `'active'`. **`auction_state` is a pointer, not a guarantee — always
   double-check the pointed-to row's live status before trusting it.**
4. **A `toLocaleTimeString()` call with no explicit locale/options** in
   `console-sales-log.tsx` (a client component, still server-rendered for
   the initial HTML) produced different strings on the server (Node's
   default locale, 24-hour) vs. the client (browser's default locale,
   12-hour) — a genuine React hydration mismatch. Fixed by pinning an
   explicit locale + `hour12: false` + fixed format options. **Any
   `toLocale*` call in a component that gets server-rendered needs an
   explicit locale/options, never the zero-arg form.**
5. **Base UI's `<Select>` does not reliably populate a `name`-prop-driven
   hidden input for `FormData` submission in this codebase** — confirmed
   the hard way after an extended debugging session (initially suspected as
   a browser-automation-tool coordinate-mapping artifact, but the real root
   cause was the component itself). The established, already-working
   convention elsewhere in the codebase (`round-form-sheet.tsx`) is to use
   `Select` as a fully **controlled** component (`value`/`onValueChange`)
   plus a **separate plain `<input type="hidden" name="..." value={state}>`**
   — never the Select's own `name` prop. `console-sale-entry.tsx` was fixed
   to follow this exact pattern. **Never use `<Select name="...">`'s
   built-in form wiring in this codebase — always pair a controlled Select
   with your own hidden input.** Relatedly: `<Select.Value>`'s default
   rendering prints the raw `value` (not a looked-up label) when value and
   label differ (e.g. team_id vs. team name) — use the render-prop form,
   `<SelectValue>{(value) => lookupLabel(value)}</SelectValue>`, whenever
   they diverge.
6. **`round_materials` file downloads were structurally broken for public
   visitors** (a genuine pre-existing gap surfaced while building
   `/rounds/[slug]`): the `submissions` storage bucket's only `select`
   policy checks `(storage.foldername(name))[1] = auth.uid()::text`, which
   a material path (`<round_id>/materials/...`, first segment is a round
   id, not a team id) can never satisfy, and there's no `anon` policy at
   all. Fixed at the app level (no migration): after the RLS-gated
   `round_materials` query itself confirms public eligibility, use
   `createAdminClient()` (already documented for exactly this use) to mint
   a short-lived signed URL per file row.
7. **`/leaderboard` never queried the `final_top_10` snapshot kind at all**
   — only `top_15`, meaning PUB-07 ("display the final published Top 10")
   was silently unimplemented despite the underlying
   `admin_publish_leaderboard('final_top_10', ...)` RPC already supporting
   it since Phase 3. Fixed by fetching both kinds (`.in("kind", ["top_15",
   "final_top_10"])`) — they can legitimately both be live simultaneously.

---

## 6. What's NOT built yet — Phases 7, 8

Read the full phase descriptions (routes, migrations, RPCs, verification
steps) in `.claude/plans/this-project-is-exclusively-starry-shore.md` — this
is a compressed summary to orient a fresh session, not a replacement for it.

### Phase 7 — Paid analytics (blocked by Phase 6, now unblocked — `purse_ledger` and shortlisted-team status both exist)
Migration: `analytics_requests`. `approve_analytics()` RPC — re-checks purse
**at approval time**, deducts and unlocks in one transaction, never
partially (AN-05, ERR-10, AT-AN-01/02). `purse_ledger.entry_kind` already
includes `'analytics'` (added in Phase 6) so this needs **zero further
ledger-schema migration** — just an insert with a negative amount and
`ref_kind='analytics_request'`. Team side: `/app/auction/analytics` (Phase
6's static locked stub) becomes real — locked tab → request (blocked when
funds insufficient) → permanently unlocked module. Build the actual
analytics module with the `dataviz` skill: player profiles, head-to-head
comparison, role/category recommendations, squad balance and gaps,
purse-aware affordable targets, rule warnings, undervalued-player
opportunities — every stat degrading gracefully when absent. Public
`/live`'s analytics badge (currently unconditionally `StatusPill
status="locked"`, per Phase 6's LIVE-07-by-construction approach) needs to
become a real conditional check once `analytics_requests` exists — **be
careful here**: it must still only ever show Locked or Purchased, never
private content (AT-AN-03). Admin: set price (already has a placeholder
column, `auction_rule_sets.analytics_price`), request queue, approve/reject.
**Verifies** AN-01…08, AT-AN-01…03.

### Phase 8 — Round 6, final results, exports, hardening (blocked by Phases 4/5/7 — needs quiz, simulation, and analytics all existing to produce the full final aggregate)
Round 6 (offline conference, online info only, standalone scoring — never
auto-combined with earlier aggregates via `stage_adjustments`/`stage_rounds`,
R6-04, AT-FIN-01). Admin-controlled final-result workflow (no hardcoded
combination formula — mirrors the explicit-array pattern already used by
`admin_publish_leaderboard('final_top_10', ...)` in Phase 3, which
`/leaderboard` already renders as of this session). Exports: teams,
submissions, scores/aggregates/ranks, import errors (the CSV-shaped error
report from Phase 6's player import is a ready-made precedent for this),
sales/reversals/rosters/final squads, activity, auction audit
(`auction_audit_events` — already the richest per-row audit trail in the
schema). Rate limiting on quiz-submit and simulation-attempt endpoints
(reuse `check_rate_limit()` — already used for `quiz_start` in Phase 4;
Phase 6's `record_sale`/`reverse_sale` are admin-only and not
rate-limit-relevant, since they're never called by participants). Structured
server logging. Full sweep of empty/loading/reconnecting/error states across
every phase (Phase 6's `ReconnectBanner`+`useLiveBroadcast` pattern is the
one to reuse for any still-missing surface). `npm run seed:demo` (synthetic
data, no real PII, no IPL trademarks). Full documentation set (`README`,
`ENV`, `MIGRATIONS`, `DEPLOY`, `ADMIN_GUIDE`, `BROWSER_SUPPORT`, plus the
already-written `docs/QUIZ_LIMITATIONS.md`). Pre-event rehearsal checklist.
**Verifies** R6-01…06, AT-FIN-01…03, §31.2 definition of done.

---

## 7. Inputs still needed from the client (per PRD §30 — none of these block development; everything ships with placeholders admins replace with no code change)

- **DEP-05**: real player import file — mandatory fields (name, role, base
  price, pool, nationality, IPL team) are known and enforced; the exact
  extended stat set is not. `player_stat_definitions` auto-discovers new
  stat keys from whatever the real file contains, so this needs zero code
  change when it arrives.
- **DEP-06**: real auction rule values — starting purse, min/max squad
  size, overseas limit, role/pool caps. Currently shipping with clearly
  placeholder defaults (`starting_purse: 100000000`, `max_squad_size: 18`,
  etc.) in `auction_rule_sets`, editable via `/admin/auction/rules`.
- **DEP-07**: real analytics price (`auction_rule_sets.analytics_price`,
  placeholder `500`).
- Round briefs/files/rubrics for Rounds 2–4 and 6, quiz question bank (the
  Phase 4 bank was QA-only and deleted), real registration fee + payment
  instructions, real registration open/close dates, final prizes copy.
- **Standing action item, still not confirmed done**: unpublish
  `team-champ-forge.lovable.app` — its unauthenticated scoring endpoint is a
  live risk to Round 5's integrity as long as it's up.

---

## 8. How to resume work in a new session

1. Read `.claude/plans/this-project-is-exclusively-starry-shore.md` in full
   (the original phase plan), `.claude/plans/private-tmp-claude-501-users-shiva-1-de-cheerful-stroustrup.md`
   (Phase 3–5 detailed design), and
   `.claude/plans/read-bidwave-claude-handoff-bidwave-hand-lexical-turing.md`
   (this session's Phase 2 + Phase 6 detailed design, including the exact
   migration SQL and every RPC signature) if you need rationale beyond
   what's summarized here.
2. Read `CLAUDE.md` (checked into the repo) — Next 16 / Base UI / Docker
   gotchas, kept current through this session.
3. Read the memory files this session updated at
   `~/.claude/projects/-Users-Shiva-1-Desktop-Bidwave/memory/` for the
   condensed version plus anything logged there, in case this handoff
   document itself goes stale.
4. **Confirm current DB state before assuming anything**: as of the end of
   this session, `teams`, `players`, `auction_rule_sets`, `purse_ledger`,
   `auction_sales`, `auction_state`, `record_locks`,
   `auction_audit_events`, `live_broadcast`, and `auth.users` are **all
   empty** — every QA fixture created during this session's browser testing
   was deliberately cleaned up at the end (see §5's bugs — the browser
   testing that found them used a throwaway `qa-admin@bidwave.test` /
   `qa-team@bidwave.test` pair plus a `QA Test Team`, all deleted). `rounds`
   has exactly the six real seeded rows from Phase 2's seed migration —
   these are **not** QA data, they're meant to stay. Verify all of this with
   a quick script using `SUPABASE_DB_URL` rather than trusting this report.
5. Decide the next phase. **Phase 7 (paid analytics) is next in sequence
   and now fully unblocked** — `purse_ledger` and the shortlisted-team
   dashboard both exist, and Phase 6 left the `entry_kind='analytics'`
   ledger case ready with no further schema change needed. Phase 8 depends
   on Phase 7, so it's not yet startable.
6. Before writing any new migration: remember the `service_role`-only grant
   gotcha (§4) — verify grants immediately after applying, don't assume —
   and the `citext`/`extensions` schema gotcha. Hand-update
   `src/lib/supabase/types.ts` in the same pass, not batched to the end.
7. Before writing any new `"use server"` action file: grep any sibling file
   you're copying the shape from for `export {.*[Ii]nitial` and make sure
   you're *not* replicating that export.
8. Before wiring any new `<Select>` inside a `<form action={serverAction}>`:
   use the controlled-value + separate-hidden-input pattern from
   `console-sale-entry.tsx`/`round-form-sheet.tsx` — do **not** rely on
   `<Select name="...">`'s own form wiring (see bug #5 above).
9. Before shipping any UI change: verify it live via the browser preview
   tooling, not just `tsc`/`eslint`/`vitest` — every bug in §5 was invisible
   to automated checks alone. Create a throwaway QA admin + QA team via the
   Supabase Admin API (`createUser` with `app_metadata.role` set, then an
   insert into `public.teams`) to test authenticated flows, and **delete
   all QA data at the end of the session** the same way this one did
   (remember `purse_ledger`'s append-only trigger must be temporarily
   disabled — `alter table purse_ledger disable/enable trigger
   purse_ledger_append_only` — to clean up any ledger rows a QA session
   created, since even the `postgres` superuser role can't bypass a BEFORE
   trigger through ordinary DML).
10. Run `npx vitest run` before considering any phase done — currently
    **40/40 passing** (29 pre-existing + 11 new `tests/auction.test.ts`),
    ~25–50s against the hosted DB. Note: genuine cross-connection
    concurrency races are hard to test safely in this harness, since a
    second real `pg.Client` can't see another transaction's uncommitted
    fixture rows, and `purse_ledger`'s append-only trigger means anything
    committed for a two-connection test can never be cleaned back up — the
    existing convention (both here and in `simulation.test.ts`) is
    sequential same-transaction calls that still genuinely exercise the
    guard clauses (stale-edit / already-sold / etc.), just not literal
    wall-clock concurrency.
