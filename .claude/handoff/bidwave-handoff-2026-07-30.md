# Bidwave — Project Handoff Report (as of 2026-07-30)

Paste this into a new session to resume the build. It's self-contained: vision, architecture,
exactly what's built through Phase 5, what's left (Phases 2, 6–8), and every non-obvious gotcha
and bug discovered so far — several of which cost real time to find and must not be
re-introduced.

---

## 1. What Bidwave is

Bidwave is an IPL-style mock auction event operating system for the **Department of Commerce,
CHRIST University** (School of Commerce, Finance and Accountancy). Event dates: **17–19 August
2026**. Tagline from the brochure: *"Think Fast. Bid Smart. Build Champions."*

It replaces forms/spreadsheets with one platform covering the whole event lifecycle: public
marketing site → team registration → six competition rounds (quiz, marketing brief, immersive
challenge, group discussion, live auction, conference) → scoring/qualification → an on-spot
"weighted-priority simulation" mini-game → a live auction console + public tracker → a
purse-funded paid analytics unlock → final results.

**Authority for all behavior**: `reference/Bidwave_Product_Requirements_Document.docx` (31
sections, ~180 numbered requirements — IDs like `REG-06`, `AUC-10`, `SIM-07` are cited in
migration headers and code comments throughout; treat them as ground truth). Landing copy derives
from `reference/BIDWAVE brochure (flags).pdf`. Both are gitignored (large binaries) but present
on disk at the project root under `reference/`.

**The full implementation plan** (phases, schema, architecture principles, decisions made with
the client) lives at `.claude/plans/this-project-is-exclusively-starry-shore.md` — **read this
file in full before making any architectural decision**; this report summarizes it but the plan
has the complete original reasoning. A second plan file,
`.claude/plans/private-tmp-claude-501-users-shiva-1-de-cheerful-stroustrup.md`, has the detailed
design for Phases 3–5 specifically (schema rationale, RPC signatures, the quiz timing-model
comparison, the simulation rubric design) — read this one before touching quiz/simulation code.

### Non-negotiable architecture principles (still binding, unchanged since Phase 0)

1. **Server is the only authority.** Eligibility, deadlines, purse, roster, quiz timers and
   simulation ordering are computed in Postgres. Client clocks are display-only (SEC-06, QZ-16,
   SIM-08).
2. **Every multi-record mutation is one plpgsql `SECURITY DEFINER` RPC**, granted to
   `service_role` only, called exclusively from trusted Next.js server code (Server Actions or a
   Route Handler). Never split a business transaction across multiple client round-trips.
3. **Round status is a SQL function of the clock**, not a cron job's last run. A missed
   `pg_cron` tick must never let a late submission through. `is_registration_open()` (Phase 1)
   and `effective_round_status()` (Phase 3) both follow this pattern; the quiz's lockstep
   schedule and the simulation's start/stop timestamps extend it further.
4. **Purse is an append-only ledger**, never a mutable column. Reversals are compensating
   entries — this is what makes "reverse any prior sale" auditable and safe. (Not built yet —
   Phase 6. Phase 5's `simulation_rewards` already has the seam for this — see §4 below.)
5. **Realtime carries no private data.** Triggers append public-safe rows to a broadcast table;
   clients subscribe by topic and refetch private detail through authorized endpoints. (Not built
   yet — Phase 6.)
6. **Two visual moods:** *Broadcast* (public/live/auction — high contrast, gold, motion) vs.
   *Console* (submission/admin — calm, dense, minimal motion). Already reflected in the design
   system.

### Approved deviations from the PRD (client-approved, don't "fix" these)

- Sponsors section removed from the public site entirely.
- The brochure's real IPL franchise flags / trophy artwork must **never** appear anywhere in the
  UI (PRD §24.2 forbids IPL brand assets) — an original broadcast visual language is used
  instead. The brochure PDF itself can still be offered as a download.
- The on-spot simulation's PRD figure of "~1,000 combinations" (SIM-04) is superseded by the
  actual 12-parameter space recovered from the reference Lovable prototype (`4⁸` categorical ×
  4 sliders) — SIM-01 makes the prototype the behavioural reference, so this supersedes the
  PRD's loose wording.
- The prototype (`team-champ-forge.lovable.app`) has a public, unauthenticated scoring endpoint
  — its answer key must **not** be reused; Bidwave generates its own 4 correct combinations
  server-side (done — see §4). The user should unpublish the prototype once Phase 5 was
  validated in front of them.

---

## 2. Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui
(**on Base UI, not Radix** — see gotchas) · `motion` (Framer Motion) · Supabase (Postgres/Auth
/Storage/Realtime, schema owned entirely by hand-written SQL migrations, no ORM) · Zod at every
boundary · Vitest (integration tests now exist and run against the hosted DB — see §7; Playwright
still not wired up).

## 3. Current environment — READ THIS FIRST

**Docker Desktop's VM disk is corrupted** on the development machine (confirmed via its own
console log: `EXT4-fs: failed to convert unwritten extents... potential data loss!`, aborted
journal, I/O errors on every write). `docker info`/`docker ps`/`docker run` all hang
indefinitely. Consequence: `supabase start` (local Postgres) is unusable, and so is anything the
Supabase CLI does via a temporary Docker container. **Do not spend time re-diagnosing this** —
check whether the user has since run Docker Desktop's "Troubleshoot → Clean/Purge data" before
assuming it's still broken; nothing in this repo can fix it.

**What actually works, and how this project is being built until Docker is fixed:**
- The app runs against a **hosted Supabase project** (`hkbpklqkpdspwqrwssdo`, region
  ap-south-1). Credentials are in `.env.local` (gitignored — not repeated here). Ask the user for
  the session-pooler connection string (Supabase dashboard → Project Settings → Database) if it's
  ever needed and missing; store it as `SUPABASE_DB_URL` in `.env.local`.
- **Migrations are applied with a plain `pg` connection**, not `supabase db push`. Pattern: a
  throwaway Node script `.apply-migration.mjs` in the project root (delete it after use — it's a
  scratch file, never commit it) using the `pg` package and `SUPABASE_DB_URL`, wrapped in
  `begin`/`commit`, that also inserts into `supabase_migrations.schema_migrations` so the CLI's
  own bookkeeping stays consistent for whenever `db push` works again. Reconstruct the shape from
  scratch each time (it's short — see any recent commit history around migrations 003–005 for the
  exact pattern): connect with `ssl: { rejectUnauthorized: false }`, run the migration file's SQL
  as one string, then insert the tracking row.
- **After every migration, read back and verify grants/RLS/indexes/cron jobs with a small script**
  — do not assume the migration did what the SQL says. This project has twice shipped a migration
  where something silently didn't take effect (see §8, bugs #1 and #2) — both were only caught by
  querying `pg_proc.proacl`/`pg_class.relrowsecurity` after applying, or by an integration test
  actually calling the function.
- **`src/lib/supabase/types.ts` is hand-written**, not generated (`supabase gen types` also needs
  Docker). It must be kept in exact sync with every migration, by hand, matching the real
  `gen types typescript` output shape (`Row`/`Insert`/`Update`/`Relationships` per table, a
  `Views` block for `rounds_with_status` and `pending_simulation_purse_awards`, and a `Functions`
  map for every RPC — **do** include `service_role`-only RPCs too, since the admin client is also
  a typed `SupabaseClient<Database>`). The file's header comment has a running `Covers:` list of
  every migration it's been kept in sync with — currently through
  `20260730060000_simulation.sql`. Update that list every time.
- Once Docker is fixed, switch back to `npm run db:start` / `npm run db:reset` / `npm run
  db:types` and treat the hosted project as staging/production only.

**A real, previously-hidden Postgres detail worth knowing going in:** Supabase grants `EXECUTE`
on newly-created public-schema functions **directly** to `anon` and `authenticated` (via its own
`ALTER DEFAULT PRIVILEGES`), not just via `PUBLIC` membership. `revoke all on function ... from
public;` alone does **not** remove that — you must explicitly `revoke ... from public, anon,
authenticated;` and grant only to `service_role`, or every mutation RPC is silently callable
directly from the browser. This has now bitten twice more since it was first caught in migration
002 — see §8, bug #2 (`tick_quiz_attempts()` was left with its default anon/authenticated grant
because it was added near the end of migration 004 and the revoke block wasn't updated). **Every
new RPC needs an explicit revoke+grant line, with no exceptions**, and the two deliberate
exceptions to "service_role only" (`can_team_submit()`, `simulation_status()` — both read-only,
self-guarded, granted to `authenticated` directly for cheap client-side polling) are documented
inline in their migrations; don't add a third without equally strong justification.

**Also**: `citext` (from migration 001) lives in the `extensions` schema. Plain SQL statements in
a migration file resolve it fine (session search_path includes `extensions` by default on this
hosted project), but any plpgsql function that sets `set search_path = ''` (correct SECURITY
DEFINER hardening) must reference it as `extensions.citext` explicitly in its own `declare`
section, or it fails with "type citext does not exist" at function-body-execution time even
though the migration's own top-level statements work fine.

**New this phase — a Next.js-specific gotcha:** a `"use server"` file **can only export async
functions** (plus type exports, which are erased at compile time and don't count). Exporting a
plain object/constant (e.g. an `initialState` literal for `useActionState`) from the same file as
your server actions throws a **runtime** error ("A 'use server' file can only export async
functions, found object") that `tsc`/`eslint` do not catch — it only surfaces when the action is
actually invoked in the browser. The fix is always the same: define the initial-state constant in
the **client** component that calls `useActionState`, not in the actions file, and only export
the `type` (types are fine) from the server file. This is already documented as a comment in
`src/app/admin/teams/team-detail-sheet.tsx` from Phase 1 — it was somehow missed writing three new
action files in Phase 3/4/5 and had to be fixed in all three. **Grep for `export {.*[Ii]nitial`
in any new `"use server"` file before considering it done.**

## 4. What's built — Phases 0–5, all verified

### Phase 0 — Foundation ✅
- Next.js 16 scaffold, Tailwind v4 + shadcn/ui (Base UI) + `motion` + Zod + Vitest wired up.
- **Design system**: dark-only palette sampled from the BidWave logo. Full token list in
  `docs/DESIGN_SYSTEM.md`. Key tokens: `--gold` `#EEC34B`, `--surface-0..4`, `--sold`/`--unsold`/
  `--live`, `--analytics` `#00AFF0` (DOC Analytica's own brand blue). Five fonts via
  `next/font/google`: Anton, League Spartan, Arapey, Inter, JetBrains Mono.
- **Brand marks**: `public/brand/*.png`, used via `<BrandMark name="..." height={n} />` from
  `@/components/bidwave` — never reference `reference/Logos/*` from app code.
- **Component kit** (`src/components/bidwave/`): `BrandMark`, `StatusPill` (single source of
  truth for every status word via `STATUS_TONES`), `StatTile`, `Money`/`MoneyDelta`, `Countdown`
  (server-clock-anchored), `FileDrop`, `EmptyState`, `ReconnectBanner`, `DataTable`. All visible at
  `/dev/kitchen-sink`.
- **Migration 001** (`20260729115900_init_foundation.sql`): extensions (`pgcrypto`, `citext`,
  `pg_cron`), `public.is_admin()`, `set_updated_at()` trigger fn, `event_editions` (seeded
  "Bidwave 2026"), `settings` (admin-editable key/value store).

### Phase 1 — Auth, registration, teams ✅
- **Migration 002** (`20260729153617_teams_and_registration.sql`): `is_registration_open()`,
  `teams` (id **is** the team's single `auth.users` id — one shared account per team forever),
  `team_members` (3–4 per team, unique per edition), `invoices`, `activity_events`,
  `rate_limit_buckets` + `check_rate_limit()`, `register_team()` RPC (atomic team+members+invoice,
  field-mapped error codes), `admin_update_team()` RPC (optimistic concurrency via
  `p_expected_updated_at`). Private `invoices` storage bucket with RLS.
- `/register` 5-step wizard, `/register/success`, `/login` (single form, role resolved from JWT
  `app_metadata`), `/app` (now a real classroom dashboard — see Phase 3), `/admin/teams` (search,
  edit, invoice viewer, admin password reset).
- `src/proxy.ts` role-based route guards (must live at `src/proxy.ts`, not root — see gotcha
  history). Every admin Server Action also calls `requireAdmin()` itself.
- 19 passing Vitest unit tests on registration validation (`src/lib/validation/registration.test.ts`).

### Phase 3 — Round engine, submissions, scoring, qualification, leaderboards ✅
**Migration** `20260730040000_rounds_scoring_leaderboards.sql`.

**Tables**: `stages`, `rounds` (kind: quiz/submission/offline_info/simulation/auction/conference;
admin override is two **one-way** timestamps `opened_early_at`/`closed_at`, never a reversible
flag — RND-05 makes reopening structurally impossible, not just trigger-blocked), `stage_rounds`
(per-round weight into a stage aggregate — resolves "quiz's raw scale vs. a rubric's max" without
guessing a normalization rule), `round_materials`, `submissions`, `submission_files`
(whole-set-replace semantics, `superseded_at` marks the prior set), `rubric_criteria`, `scores`
(**`source` column** — `'manual'|'quiz'|'simulation'` — is the seam every automated round writes
through, so a stage aggregate never silently omits a round), `score_criterion_values`,
`stage_adjustments` (ad-hoc additions to a stage aggregate, e.g. a simulation marks reward, so
Phase 5 never needs to touch Phase 3's scoring schema), `qualifications`, `leaderboard_snapshots`
+ `leaderboard_snapshot_entries` (append-only; publish writes a new snapshot, hide only stamps
`hidden_at` — nothing is ever mutated in place), `announcements`. Private `submissions` storage
bucket (no team read policy once a round is closed — enforced in RLS, not just UI).

**Key functions**: `effective_round_status(rounds)` (clock function mirroring
`is_registration_open()`), `rounds_with_status` view (`security_invoker = true` — this project's
first view), `can_team_submit()` (separates "Open — eligible" from "Open — view only"; the one
other documented exception granted directly to `authenticated`), `submit_round_files()`,
`admin_upsert_round()`, `admin_set_round_lifecycle()` (dispatcher: open_now/close_now/
start_scoring/mark_scored/release_publicly/archive/unrelease), `admin_upsert_round_material()`,
`admin_upsert_rubric_criterion()`, `admin_save_score()` (recomputes total from criteria
server-side so a client-sent total can never disagree with its own breakdown),
`admin_publish_scores_for_round()`, `stage_standings()` (weighted sum + a **small closed
vocabulary** of tie-breaker rules — `higher_round_score`/`earlier_submission` — not open SQL),
`admin_confirm_qualifications()`, `admin_set_stage_rounds()`, `admin_add_stage_adjustment()`,
`admin_publish_leaderboard()` (one live snapshot per kind at a time), `admin_hide_leaderboard()`,
`admin_upsert_announcement()`. One `pg_cron` job (`materialize-round-status`, advisory-only, logs
transitions to `activity_events`).

**UI**: `/app` classroom dashboard (round cards using the exact §8.1 status vocabulary already
in `StatusPill`'s `STATUS_TONES`), `/app/rounds/[id]` (materials, rubric, `FileDrop` submission),
`/admin/rounds` (list + create/edit Sheet + inline lifecycle-action buttons), `/admin/rounds/[id]`
(tabbed workspace: Materials / Rubric (or Quiz bank) / Submissions / Scores), `/admin/stages`
(standings + qualification confirm), `/admin/leaderboard` (publish/hide Top 15 and Final Top 10),
minimal public `/leaderboard`.

### Phase 4 — Round 1 quiz engine ✅
**Migration** `20260730050000_quiz_engine.sql`.

**Timing model, decided and built: lockstep schedule**, not a rolling per-question timer. Once a
team starts, question *k*'s window is `started_at + Σ(timers before k)` → `started_at +
Σ(timers through k)` — a pure function of the clock. No "Next" button, no
`advance_quiz_question` RPC exists at all (that tamper surface was deleted, not defended). This
satisfies QZ-14/16 *by construction* and mirrors architecture principle #3 one level down. Cost
accepted: no early finish, forced dead time on a fast answer.

**Tables**: `quiz_questions` (no `is_starred` column — QZ-03's star is purely `weight > 1`,
derived in the UI), `quiz_options` (admin-only select under RLS — the anti-cheat crux;
correctness never reaches the browser except through the curated `get_quiz_state()` payload),
`quiz_attempts` (`question_order`/`timer_seconds` are a **materialised snapshot**, not a
reproducible seed — an admin editing the bank mid-window cannot shift an in-flight attempt's
schedule; a **partial unique index** on `(round_id, team_id) where status <> 'archived'` makes
"one continuous attempt" structural while still allowing `admin_reset_quiz_attempt()` to archive
a stuck attempt and grant a fresh one), `quiz_answers`, `quiz_events` (exit/reconnect audit).

**Key functions**: `quiz_current_index()` (the one schedule formula every caller shares),
`start_quiz_attempt()` (independent per-team shuffle, blocks late entry if not enough time
remains before the round closes), `get_quiz_state()` (pure read — reconnecting after 8 minutes
away is one SELECT, never an iterative catch-up loop), `save_quiz_answer()` (rejects once the
question's own window elapsed), `submit_quiz_attempt()` (**idempotent** — a beacon racing the
Submit button is always a safe no-op; writes `scores` with `source = 'quiz'`, `published =
false` — **release-gated, the locked decision**: a team never sees its quiz score until the
admin explicitly publishes, exactly like Rounds 2–4), `log_quiz_events()`,
`tick_quiz_attempts()` (a `pg_cron` backstop for a crashed/closed-tab team — finalizes any
attempt whose `scheduled_ends_at` passed >30s ago; this is genuinely load-bearing, not purely
advisory, since nothing else finalizes an abandoned attempt), `admin_reset_quiz_attempt()` (the
fairness escape hatch for a genuine hardware failure — not a routine control),
`validate_quiz_bank()`, `admin_upsert_quiz_question()` (delete-and-reinsert-all-options-per-save,
simpler than separate option CRUD).

**UI**: `/app/quiz/[roundId]` runner (pre-flight confirmation → fullscreen request
→ one question per screen with a live countdown → autosave on click → exit detection via
`fullscreenchange`/`visibilitychange`/`pagehide`, the last one hitting a dedicated
`/api/quiz/submit` Route Handler via `navigator.sendBeacon` since a Server Action can't be
invoked from a beacon), `/admin/rounds/[id]`'s "Quiz bank" tab (question builder + attempt
monitor + reset action). `docs/QUIZ_LIMITATIONS.md` — an honest, PRD-mandated (§10.2) writeup of
what a browser genuinely can and can't lock down; read it before anyone asks "can we make the
quiz more secure."

### Phase 5 — On-spot weighted-priority simulation ✅
**Migration** `20260730060000_simulation.sql`.

**The design problem this migration solves**: with a 0/1 match per parameter, every sub-score is
a step function and the round degenerates to brute force over 65,536 categorical combinations.
The fix, built and verified: **graded partial credit** (a 4×4 matrix per categorical parameter
giving credit in `[0,1)` for a wrong-but-adjacent option, diagonal = 1.0) plus **tolerance-band
slider matching** (`credit = clamp(1 - max(0, |value−target|−tolerance)/falloff, 0, 1)`, step-5
snapped) turns every sub-score into a distance signal a team can hill-climb against. `success` is
**never** a score threshold — it's `true` iff every categorical exactly matches one of the 4 keys
*and* every slider is inside that key's tolerance band, which decouples "which submissions win"
(fixed forever, SIM-05) from "how hard the rubric feels" (fully admin-tunable via JSON, no code
change). Verified live: all-defaults evaluates to **exactly 70** (enforced three ways — the
generator/save-time evaluator solves for the calibration offset, a table `CHECK
(defaults_overall = 70)` refuses a bad config outright, and `submit_simulation_attempt()` refuses
to run against a config that fails the check); moving one categorical parameter toward a correct
key moved the live score from 70 → 94 in browser testing, confirming the gradient actually works
as a hill-climbing signal, not just in theory.

**Tables**: `simulation_config` (three trust-scoped jsonb columns — `parameters` public-safe,
`scoring` private, `answer_key` service_role-only and column-sensitive; **no team select policy
on this table at all**, so `scoring`/`answer_key` can never leak through a forgotten column strip
— a team only ever sees `parameters` through the curated `simulation_status()` RPC),
`simulation_attempts` (a **partial unique index** on `(config_id, winner_rank) where winner_rank
is not null` combined with a row lock on `simulation_config` in `submit_simulation_attempt()`
makes "exactly two winners, ever" race-safe, not merely likely — this exact mechanism was
exercised with three sequential submissions in both the Vitest suite and live browser testing:
first correct → rank 1, second correct → rank 2, third correct → rejected
`simulation_already_won`), `simulation_rewards` (SIM-11: a team gets marks **or** purse, never
both, via `unique(config_id, team_id)`; `purse_ledger_entry_id uuid` with **no FK yet** — Phase 6
adds `references public.purse_ledger(id)` as a validating `ADD CONSTRAINT`, not a rewrite; a
`pending_simulation_purse_awards` view is the consumption contract Phase 6 codes against).

**Key functions**: `simulation_evaluate()` (the rubric engine — evaluates a submission against
all 4 keys, returns the nearest-key result so hill-climbing stays coherent; `matched_key_index`
is computed internally for calibration but **never** returned to a team — that lossiness is the
puzzle), `simulation_status()` (the other documented `authenticated`-grant exception — read-only
clock function, no per-team branching, never exposes `scoring`/`answer_key`),
`submit_simulation_attempt()` (row-locks the config, enforces the submit cooldown as an anti-spam
floor — not an attempt cap, since SIM-06 mandates unlimited attempts), `admin_save_simulation_config()`
(runs the exact same evaluator against an all-defaults vector before allowing a save — calibration
is enforced, not hoped), `admin_set_simulation_lifecycle()` (start/stop), `admin_confirm_simulation_reward()`.

**UI**: `/app/simulation` (12-section console — 8 categorical button-grids + 4 sliders — ANALYZE
action, result panel with sub-score `StatTile`s, own-team-only attempt history; polls
`simulation_status()` every 4s, which doubles as the "is it still active" check and the countdown
source), `/admin/simulation` (JSON textareas for parameters/scoring/answer_key — deliberately
simple, since "config not code" only requires that a change doesn't need a deploy, not a
polished visual editor; start/stop, live attempt feed, reward confirmation form). New shared
primitive: `src/components/ui/slider.tsx` (wraps `@base-ui/react/slider`, shadcn-style, matching
this project's Base UI convention — **`Slider.Value` requires being nested inside `Slider.Root`**,
found the hard way; the simulation console displays the numeric readout as a plain `<span>`
instead of using `SliderValue` to sidestep that).

### Phase 3–5 testing ✅
`tests/helpers/db.ts` + `tests/rounds.test.ts` + `tests/quiz.test.ts` + `tests/simulation.test.ts`
— a genuine integration suite (not unit tests) that opens a real `pg` connection to the **hosted**
DB using `SUPABASE_DB_URL`, wraps every test in `BEGIN...ROLLBACK` (with a `SAVEPOINT` helper,
`expectRejection()`, for tests that need to assert an error and then keep querying in the same
transaction — Postgres aborts the whole transaction after any raised exception otherwise), and
calls the real RPCs directly as the `postgres` role (which bypasses both RLS and the
`service_role`-only grants, the same way the admin client does in production). Nothing is ever
left behind in the hosted project. **29 tests passing** across the whole suite (19 from Phase 1's
Vitest unit tests + 10 new integration tests), covering AT-RND-02/03, AT-SCR-01, AT-LDB-01,
AT-QZ-02/04/05, AT-SIM-03/04. Run with `npx vitest run`.

---

## 5. Real bugs found and fixed this session — read before writing similar code

All of these were invisible to `tsc`/`eslint`/`vitest`; every one was only caught by either
querying Postgres system catalogs directly after a migration, or by actually driving the app in
a browser. This project's pattern (documented since Phase 1) continues to hold: **do not skip
live browser verification for UI work, and do not skip a grants/RLS readback after a migration.**

1. **`submit_simulation_attempt()` used `->>` instead of `->`** when building the jsonb it
   returns for `overall`/`success`. `->>` extracts as *text*, so `false` came back as the string
   `"false"` — which is truthy in JavaScript. Caught by a Vitest assertion
   (`expect(...).toBe(true)` failing against the string `'true'`), not by any type system, since
   the RPC's declared return type is just `Json`. **Lesson: when building a jsonb response meant
   to preserve real types for a JS caller, use `->` (or build with `jsonb_build_object` from
   already-typed plpgsql variables), never `->>`, for anything boolean or numeric.**
2. **`stage_standings()`'s `adjustments` CTE had a bare `team_id` column reference** that PL/pgSQL
   resolved as ambiguous against the function's own `RETURNS TABLE (team_id uuid, ...)` output
   parameter of the same name. Fixed by qualifying it (`stage_adjustments.team_id`). **Lesson: any
   `RETURNS TABLE` function with a column name that collides with a real table's column needs
   every bare reference to that name qualified inside the function body, even inside a CTE that
   looks locally unambiguous.**
3. **Three new `"use server"` action files exported an initial-state object constant** —
   forbidden by Next.js, only surfaces as a runtime "module evaluation" error when a Server
   Action is actually invoked. See the gotcha writeup in §3. Fixed in
   `admin/rounds/actions.ts`, `admin/rounds/quiz-actions.ts`, `admin/simulation/actions.ts`, and
   all seven of their consuming client components.
4. **The quiz runner awaited `document.documentElement.requestFullscreen()`.** In this session's
   automated browser-testing context that promise never resolved or rejected at all, silently
   hanging the *entire* quiz-start sequence forever (the UI sat on "Starting..." with no error and
   no network request ever firing). Fixed by not awaiting it — call it, attach a
   `.catch(() => undefined)`, and move on immediately to `startQuizAttempt()`. Fullscreen is a
   "strongest practical" best-effort per §10.3 of the PRD, never a hard gate on the attempt
   actually starting. **This is very likely to also affect real users on some browser/OS
   combinations that don't grant fullscreen synchronously from a click handler — treat this as a
   correctness fix, not just a test-environment workaround.**
5. **The team dashboard and round-detail page computed "submitted?" only from the `submissions`
   table**, which is correct for `kind = 'submission'` rounds but quiz rounds track completion via
   `quiz_attempts` instead. A team that fully completed the quiz still saw an "Open" pill instead
   of "Submitted" on their dashboard. Fixed by branching on `round.kind === 'quiz'` and checking
   `quiz_attempts.status` instead.
6. **`SliderValue` (Base UI) was rendered outside a `<Slider.Root>`**, crashing with "Base UI:
   SliderRootContext is missing." Simplified to a plain `<span>{value}</span>` for the numeric
   readout in the simulation console — much less fragile than fighting Base UI's context
   requirement for a simple readout.
7. **The simulation console cast the RPC's return value directly as the client's `Attempt`
   type.** `submit_simulation_attempt()` returns `{attempt_id, overall, success, sub_scores,
   winner_rank}`, but the client's `Attempt` type (matching a row read back from the
   `simulation_attempts` table) expects `id`/`server_ts`. The cast silently produced
   `id: undefined` for every newly-submitted attempt pushed into local history state — a real
   "objects in a list need a unique key" bug (confirmed via a genuine React console warning), not
   just a cosmetic one, since it also meant attempt history couldn't be deduplicated/keyed
   correctly. Fixed by explicitly mapping the RPC's response shape to the client shape rather than
   casting.

---

## 6. What's NOT built yet — Phases 2, 6, 7, 8

Read the full phase descriptions (routes, migrations, RPCs, verification steps) in
`.claude/plans/this-project-is-exclusively-starry-shore.md` — this is a compressed summary to
orient a fresh session, not a replacement for it. The plan's phase order isn't a hard dependency
chain except where noted below.

### Phase 2 — Public site (blocked by nothing; can run independently of anything else)
Landing page built from the brochure: hero (BidWave lockup, 17–19 Aug 2026, register CTA), about
section ("Think Fast. Bid Smart. Build Champions."), six round cards (*The Stat Sprint ·
Operation Fan Heist · The Immersive Challenge · Crisis Room · The Grand Auction · The Owners'
Summit*), day-wise schedule, prizes (admin-editable, reads from the `settings` table already
built in Phase 0), general guidelines, FAQs, contacts (Neha Rani CK, Ankitha, Adith P — from the
brochure, also already seeded in `settings`), Instagram link, brochure PDF download, three-logo
footer + DOC Analytica credit. `/rounds/[slug]` gated on `public_released_at` (this column
already exists on `rounds` from Phase 3 — the plumbing is there, just no public-facing route
consumes it yet). `/leaderboard` (a bare-bones version already exists from Phase 3 — this phase
would give it full landing-page styling) and a `/live` shell (Phase 6 fills it in). Reduced-motion
path.
**Verifies** PUB-01…08, §6.1.

### Phase 6 — Auction (blocked by nothing structurally, but the natural next phase since it's
the PRD's centerpiece and Phase 5's simulation rewards have a seam waiting for it)
New migrations: `players` (+ `stats jsonb`), `player_stat_definitions`, `auction_rule_sets`,
`purse_ledger` (**append-only**, principle #4), `auction_sales`, `auction_state`, `record_locks`,
`auction_audit_events`, `live_broadcast`. **Phase 5 already left two concrete hooks for this
phase**: (a) `simulation_rewards.purse_ledger_entry_id uuid` has no FK yet — add
`references public.purse_ledger(id)` as an `ADD CONSTRAINT` once the table exists; (b) the
`pending_simulation_purse_awards` view is the read contract — iterate it, write one
`purse_ledger` row per record with `entry_kind = 'sim_bonus'`, then stamp `purse_applied_at` +
`purse_ledger_entry_id` (idempotency guard: `purse_applied_at is null`).

Player import (CSV/XLSX via `papaparse`/`exceljs`, per-row Zod validation + downloadable error
report), configurable rule sets (purse, squad min/max, role caps, overseas limits, pool rules),
`record_sale()`/`reverse_sale()` RPCs (lock player + team, validate every rule, return **every**
violated rule on failure — zero partial writes, AT-AUC-01…03), optimistic `lock_version` +
`record_locks` → conflict warning instead of silent overwrite (AUC-13…16, ERR-07, AT-AUC-05).
Admin console built keyboard-first for auction-floor speed (§24.4 — no confirmation friction on
routine sales). Public `/live`: pools, player statuses, chronological sales/reversal feed, all
rosters, purse bars, analytics Locked/Purchased only (never content). Realtime subscription +
reconnect-and-refetch fallback (ERR-08, NFR-05, principle #5 — broadcast rows carry no private
data). Shortlisted-team dashboard: roster, purse with transaction impact, rule compliance, **no
bidding controls anywhere** (TEAM-AUC-05 — the auction is physically offline, admin-recorded
only). `end_auction()` transforms `/live` into the final squad summary (LIVE-08).
**Verifies** AUC-01…20, LIVE-01…08, TEAM-AUC-01…06, AT-AUC-01…05.

### Phase 7 — Paid analytics (blocked by Phase 6 — needs `purse_ledger` and shortlisted-team
status to exist)
Migration: `analytics_requests`. `approve_analytics()` — re-checks purse **at approval time**,
deducts and unlocks in one transaction, never partially (AN-05, ERR-10, AT-AN-01/02). Team:
locked tab → request (blocked when funds insufficient) → permanently unlocked module. Module
(build with the `dataviz` skill): player profiles, head-to-head comparison, role/category
recommendations, squad balance and gaps, purse-aware affordable targets, rule warnings,
undervalued-player opportunities — every stat degrading gracefully when absent. Public tracker
shows Locked/Purchased only, never content (AT-AN-03). Admin: set price, request queue,
approve/reject.
**Verifies** AN-01…08, AT-AN-01…03.

### Phase 8 — Round 6, final results, exports, hardening (blocked by Phases 4/5/7, since it
depends on the quiz, simulation, and analytics all existing to produce the full final aggregate)
Round 6 (offline conference, online info only, standalone scoring — never auto-combined with
earlier aggregates via `stage_adjustments`/`stage_rounds`, R6-04, AT-FIN-01). Admin-controlled
final-result workflow (no hardcoded combination formula — mirrors the explicit-array pattern
already used by `admin_publish_leaderboard('final_top_10', ...)` in Phase 3). Exports: teams,
submissions, scores/aggregates/ranks, import errors, sales/reversals/rosters/final squads,
activity, auction audit (REP-01…07). Rate limiting on quiz-submit and simulation-attempt
endpoints (reuse `check_rate_limit()` — already used for `quiz_start` in Phase 4; extend the same
pattern to `submit_quiz_attempt`/`submit_simulation_attempt` if not already rate-limited).
Structured server logging. Full sweep of empty/loading/reconnecting/error states across every
phase. `npm run seed:demo` (synthetic data, no real PII, no IPL trademarks). Full documentation
set (`README`, `ENV`, `MIGRATIONS`, `DEPLOY`, `ADMIN_GUIDE`, `BROWSER_SUPPORT`, plus the
already-written `docs/QUIZ_LIMITATIONS.md`). Pre-event rehearsal checklist.
**Verifies** R6-01…06, AT-FIN-01…03, §31.2 definition of done.

---

## 7. Inputs still needed from the client (per PRD §30 — none of these block development;
everything ships with placeholders that admins replace with no code change)

Round briefs/files/rubrics for Rounds 2–4 and 6, quiz question bank (real content — the current
bank is 2 QA test questions and has been deleted), player import file with real stats, real
auction rule values (purse/squad/overseas limits), real analytics price, final prizes copy,
registration fee + payment instructions (currently placeholder in `settings`), real registration
open/close dates. The DOC Analytica logo and the Lovable prototype spec — both previously
pending — have already been received/recovered and are fully incorporated (Phase 5's rubric
design **is** the recovered spec, calibrated and verified).

**Standing action item for the client, not yet done as far as this session knows:** unpublish
`team-champ-forge.lovable.app` — its unauthenticated scoring endpoint is a live risk to Round 5's
integrity as long as it's up, independent of Bidwave's own progress.

---

## 8. How to resume work in a new session

1. Read `.claude/plans/this-project-is-exclusively-starry-shore.md` in full (the original phase
   plan) and `.claude/plans/private-tmp-claude-501-users-shiva-1-de-cheerful-stroustrup.md` (the
   Phase 3–5 detailed design — schema rationale and RPC signatures for everything in §4 above).
2. Read `CLAUDE.md` (checked into the repo) — Next 16 / Base UI / Docker gotchas, kept current
   through Phase 5.
3. Read the memory file this session wrote —
   `~/.claude/projects/-Users-Shiva-1-Desktop-Bidwave/memory/bidwave-phase-3-4-5-status.md` — for
   the condensed version of this report plus the exact bug list, in case this handoff document
   itself goes stale.
4. Confirm current DB state before assuming anything: `teams`, `rounds`, `simulation_config`
   should all be empty (all QA test data was deleted at the end of this session) — verify with a
   quick script using `SUPABASE_DB_URL` rather than trusting this report.
5. Decide the next phase. Phase 2 (public site) has no blockers and is the most standalone choice
   if the goal is breadth. Phase 6 (auction) is the PRD's centerpiece and the natural
   continuation of the phases just built, but is a large phase — read its plan section in full
   before starting and consider whether to scope it into sub-sessions (data model + import, then
   the sale/reversal RPCs, then the live console, then the public tracker).
6. Before writing any new migration: remember the `service_role`-only grant gotcha (§3) — verify
   grants immediately after applying, don't assume — and the `citext`/`extensions` schema gotcha.
   Hand-update `src/lib/supabase/types.ts` in the same pass, not batched to the end.
7. Before writing any new `"use server"` action file: grep any sibling file you're copying the
   shape from for `export {.*[Ii]nitial` and make sure you're *not* replicating that export — put
   the initial-state literal in the client consumer instead.
8. Before shipping any UI change: verify it live via the browser preview tooling, not just
   `tsc`/`eslint`/`vitest` — every bug in §5 was invisible to automated checks and was only caught
   by actually driving the app. Create a throwaway QA admin + QA team via the Supabase Admin API
   (see any recent `.create-qa-*.mjs` pattern in git history) to test authenticated flows, and
   **delete all QA data at the end of the session** the same way this one did.
9. Run `npx vitest run` before considering any phase done — the integration suite in `tests/`
   is fast (~4s) and catches real Postgres-level regressions (see bugs #1 and #2 in §5) that no
   other check will.
