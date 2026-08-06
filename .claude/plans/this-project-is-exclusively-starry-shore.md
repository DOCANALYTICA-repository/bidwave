# Bidwave — Implementation Plan

## Context

The Department of Commerce (School of Commerce, Finance and Accountancy, CHRIST University) is running **BIDWAVE — "The Pulse of IPL Auction"** on **17–19 August 2026**: a six-round, IPL-style mock auction competition. Today the event has no software. Rounds would be run on scattered forms, spreadsheets and manual reconciliation, and the physical auction has no live source of truth — which is exactly where a mock auction breaks down (wrong purse, illegal squad, disputed sale order).

Bidwave is the single **event operating system** that replaces all of that: it markets the event, registers teams, releases rounds, collects submissions, scores and shortlists, runs an on-spot simulation, drives a live broadcast-grade auction console and public tracker, sells a purse-funded analytics unlock, and publishes final results — all from one authenticated system with one admin role.

The authority for behaviour is `Bidwave_Product_Requirements_Document.docx` (31 sections, ~180 numbered requirements). Visual identity derives from `Logos/5.png` / `Logos/6.png`; landing content derives from `BIDWAVE brochure (flags).pdf`. Intended outcome: a production-ready platform rehearsed with realistic seed data before 17 August 2026, with an admin operating guide and ownership handed to the department.

### Decisions confirmed with the user
| Topic | Decision |
|---|---|
| Hosting | **Supabase + Vercel** |
| Simulation (DEP-02) | Prototype at `team-champ-forge.lovable.app` **inspected and fully specified** (see below). Parameter space, feedback model and UI mirrored; **Bidwave gets a fresh answer key** |
| Simulation space | Keep the prototype's **12 parameters** (4⁸ categorical × 4 sliders). SIM-04's "~1,000" treated as loose wording; SIM-01 makes the prototype authoritative |
| DOC Analytica logo | **Received** — `Logos/analytica_logo.png`, clean transparent PNG, wordmark + cloud/chart/arrow mark. Used directly, no reconstruction needed |
| Content gaps | Admin-editable with placeholders. **Sponsors section removed entirely** (approved deviation from PUB-01 / §4.1) |
| IPL assets | Original visual language only. The brochure's real franchise flags and TATA IPL trophy are **not** reproduced (§24.2). Brochure PDF remains a download |

### ⚠ Security finding — act before the event
The prototype is publicly deployed at a guessable URL with an **unauthenticated, unlimited-use scoring endpoint** (`POST /_serverFn/e6e4239f…`). Any participant who finds it can probe for the correct combinations before 17 August. Because the first two correct submissions win (SIM-07), reusing its answer key would compromise the round before it starts. Mitigations, both adopted: Bidwave generates its **own** 4 combinations, and the prototype should be **unpublished** once the rebuild is validated.

---

## Recovered simulation specification (DEP-02 — closed)

Extracted from the deployed prototype's client bundle and live endpoint. This is now a complete build spec.

**8 categorical sections × 4 options** (verbatim, defaults **bold**):

| # | Key | Options |
|---|---|---|
| 01 | `battingCore` | Aggressive · **Balanced** · Anchor Heavy · Finisher Heavy |
| 02 | `powerplay` | Attack · Defensive · **Balanced** · Flexible |
| 03 | `middleOvers` | Spin Control · **Rotation** · Boundary Hunting · Mixed |
| 04 | `deathOvers` | Yorkers · Variations · Pace Off · **Mixed** |
| 05 | `captainStyle` | **Tactical** · Aggressive · Calm · Analytical |
| 06 | `bowlingAttack` | Pace Heavy · Spin Heavy · **Balanced** · Matchup Based |
| 07 | `fielding` | Athletic · Safe · Specialist · **Mixed** |
| 08 | `benchStrategy` | Experienced · Young · Matchup · **Balanced** |

**4 sliders**, 0–100, default 50: `riskAppetite` (09) · `dataAnalytics` (10) · `fitnessPriority` (11) · `teamChemistry` (12).

**Evaluation contract** — `{ success: boolean, scores: { batting, bowling, leadership, fielding, bench, chemistry }, overall }`. All-defaults scores **70** overall. The six sub-scores are the *entire* feedback channel: they are how a team converges on a correct formula without brute force. Server-side only; the correct set is never sent to the client.

**Result UI to reproduce:** jersey-number-7 player silhouette that turns green on success / red on failure with a pulsing glow · "Team Balance Score" radial for `overall` · six labelled sub-score radials (BATTING, BOWLING, LEADERSHIP, FIELDING, BENCH, CHEMISTRY) animating up from 0 · status panel reading `STAR PLAYER / AWAITING FORMULA / ● STANDBY` · failure copy "This combination is not one of the four championship formulas. Recalibrate and try again." · on success, confetti plus a synthesised crowd-roar (Web Audio, ~3.5s) · tagline "ONLY 4 OF THOUSANDS OF COMBINATIONS ARE PERFECTLY BALANCED".

**Deliberate deviations:** the prototype's neon blue/gold Orbitron-Rajdhani skin is **re-skinned to the BidWave gold-on-black system** for a coherent design language (§24.2, TECH-03). Crowd audio is opt-in and respects reduced-motion (UX-05). The scoring model is reimplemented as an admin-editable weighted rubric per sub-score, so the answer key and difficulty can be tuned without a code change.

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| App | **Next.js 15 App Router**, React 19, TypeScript `strict` | Server-authoritative rendering + route handlers; Vercel-native |
| Styling | **Tailwind CSS v4** (`@theme` tokens) + **shadcn/ui** (owned Radix primitives) | Restylable to the BidWave system; keyboard/a11y for free (NFR-11, TECH-03) |
| Motion | **`motion`** (Framer Motion v11+) | Mandated by UX-01 |
| DB / Auth / Storage / Realtime | **Supabase** | Postgres transactions + RLS, private buckets, Realtime, `pg_cron` (§25.2) |
| Schema authority | **Supabase CLI SQL migrations** (`supabase/migrations/`) + `supabase gen types` | Single source of truth. Drizzle deliberately rejected — RLS, triggers and plpgsql RPCs are first-class in SQL, and two schema authorities is a defect factory |
| Validation | **Zod** at every boundary (forms, route handlers, RPC wrappers, CSV rows) | TECH-02 |
| Imports | **`papaparse`** (CSV) + **`exceljs`** (XLSX) | AUC-02, AUC-05, REP-04 |
| Charts | **Recharts** + hand-rolled SVG for broadcast meters — built via the `dataviz` skill | §17.1 analytics, UX-04 |
| Tests | **Vitest** (business rules, against local Supabase) + **Playwright** (critical E2E) | TECH-04 |

### Architecture principles
1. **Server is the only authority.** Eligibility, deadlines, purse, roster, quiz timers and simulation ordering are computed in Postgres. Client clocks are display-only (SEC-06, QZ-16, SIM-08).
2. **Every multi-record mutation is one plpgsql `SECURITY DEFINER` RPC.** `record_sale`, `reverse_sale`, `recall_player`, `approve_analytics`, `submit_simulation_attempt`, `register_team`, quiz lifecycle. Guarantees atomicity in one round-trip and is safe under Supabase's transaction pooler (AUC-12, NFR-04, ERR-10).
3. **Schedules are never trusted to a job.** Effective round status is a SQL function of `opens_at`/`closes_at`/`status_override` vs `now()`, so a missed `pg_cron` tick can never let a late submission through. `pg_cron` only *materializes* transitions and fires notifications (RND-01/02, ERR-03).
4. **Purse is a ledger, not a column.** `purse_ledger` append-only (`start`, `sim_bonus`, `purchase`, `reversal`, `analytics`); remaining purse is a sum. Reversal is a compensating entry, never a mutation — which is what makes AUC-17 ("reverse *any* prior sale") safe and auditable.
5. **Realtime carries no private data.** Triggers append public-safe rows to `live_broadcast(topic, payload)`; clients subscribe by topic and refetch private detail through authorized endpoints. Removes any chance of the public tracker leaking analytics or PII (LIVE-07, SEC-11, AT-AN-03).
6. **Two visual moods.** *Broadcast* (public, live, auction) — high contrast, gold, motion, large tabular numerals. *Console* (submission, admin) — calm, dense, minimal motion (§24.2).

---

## Design system

Sampled from `Logos/5.png`. Dark-only — matches the brochure and the broadcast context.

```
Gold        #EEC34B  (core, from logo)   bright #F5D77A   deep #C9A03A
Surfaces    #000000 → #0A0A0B → #101012 → #17171A → #1F1F23
Text        #FFFFFF / #A8A8AE / #6E6E76
Semantic    sold #3FBF7F   unsold/blocked #E5484D   live #F5A524
Analytics   #00AFF0  (DOC Analytica's own blue, from the received mark — ties the data-viz language to its author)
Turf        #2E7D32  (sparing accent)
```

**Type** (brochure-faithful, all Google Fonts via `next/font`):
`Anton` display (stand-in for the brochure's commercial *Zuume Rough Bold*) · `League Spartan` headings/labels · `Arapey` editorial serif · `Inter` UI/body · `JetBrains Mono` tabular numerals for purse, scores, timestamps.
*If the department licenses Zuume Rough, swapping it in is a one-file change.*

**Logo placement** — `public/brand/`, both polarities:
- Public header + footer: CHRIST · DOC · BidWave three-up, mirroring brochure page 1.
- **DOC Analytica**: (a) persistent "Analytics by DOC Analytica" lockup heading the paid analytics module — its natural home; (b) a "Built by DOC Analytica" credit block in the global footer; (c) the admin sign-in screen and console sidebar footer. Prominent and attributed, never overlapping content.

Deliverable: `docs/DESIGN_SYSTEM.md` + a `/dev/kitchen-sink` route showing every component state.

---

## Data model

~30 tables in `supabase/migrations/`. Concepts per PRD §20, with these deliberate refinements:

**Identity** `event_editions` · `teams` (→ Supabase Auth user; unique CI name) · `team_members` (unique CI register_number, christ_email) · `invoices` · `activity_events`
**Rounds** `rounds` (kind: quiz/submission/offline_info/simulation/auction/conference) · `round_materials` (per-item `public_release`) · `submissions` · `submission_files` (`superseded_at` — latest set only) · `announcements`
**Quiz** `quiz_questions` (weight, timer_seconds) · `quiz_options` · `quiz_attempts` (order seed, current index, `current_question_started_at`, session lock, exit_reason) · `quiz_answers` · `quiz_events` (exit audit)
**Scoring** `rubric_criteria` · `scores` (+ `published`) · `score_criterion_values` · `stages` (r1_r2, r3_r4, r6, final + tie-breaker config) · `qualifications` (rank + aggregate snapshot, admin decision) · `leaderboard_snapshots` (immutable published entries — §20.1)
**Simulation** `simulation_config` (parameters, correct combinations, global timer) · `simulation_attempts` (`server_ts DEFAULT clock_timestamp()`, `winner_rank`) · `simulation_rewards`
**Auction** `players` (+ `stats jsonb`) · `player_stat_definitions` (extensible metrics — §17.2) · `auction_rule_sets` · `purse_ledger` · `auction_sales` · `auction_state` · `record_locks` · `auction_audit_events` · `live_broadcast`
**Analytics** `analytics_requests`
**Config** `settings` (WhatsApp link, prizes, fee/payment copy, registration window, FAQs, contacts)

RLS on every table. Team policies scope to `auth.uid()`; admin policies check `auth.jwt() -> 'app_metadata' -> 'role' = 'admin'`; public policies expose only published/released rows. Private buckets `invoices` / `round-materials` / `submissions` — access exclusively via short-lived signed URLs minted after a server-side authorization check (SEC-04).

**Constraints that encode the rules:** unique team name / register number / member email (AT-REG-03/04) · partial unique on active `analytics_requests` (AN-06) · unique `(round_id, team_id)` on submissions and attempts (QZ-08) · check that `winner_rank ≤ 2` (SIM-07) · trigger blocking `closed → open` (RND-05).

---

## Route map

**Public** `/` · `/rounds` · `/rounds/[slug]` · `/schedule` · `/prizes` · `/leaderboard` · `/live` · `/faqs` · `/register` · `/register/success` · `/login`
**Team** `/app` (classroom) · `/app/rounds/[id]` · `/app/quiz/[roundId]` · `/app/simulation` · `/app/scores` · `/app/auction` · `/app/auction/analytics` · `/app/round6` · `/app/announcements`
**Admin** `/admin` · `/admin/teams[/id]` · `/admin/rounds[/id]{,/quiz,/submissions,/scores}` · `/admin/stages/[code]` · `/admin/leaderboard` · `/admin/simulation` · `/admin/auction/{players,rules,console,analytics}` · `/admin/round6` · `/admin/final-results` · `/admin/activity` · `/admin/audit` · `/admin/exports` · `/admin/settings`

---

## Delivery phases

Each phase ends with working software I demo before moving on.

### Phase 0 — Foundation
Scaffold Next.js 15 + TS strict + Tailwind v4 + shadcn/ui + motion + Zod. `supabase init/start`. Migration 001: extensions, enums, `event_editions`, `settings`, admin JWT helper. Design tokens, fonts, `public/brand/` assets. Component kit: Button, Card, StatusPill, DataTable, Dialog, Drawer, Toast, Tabs, Field, FileDrop, Countdown, StatTile, Money, EmptyState, Skeleton, ReconnectBanner. `/dev/kitchen-sink`, `docs/DESIGN_SYSTEM.md`.

### Phase 1 — Auth, registration, teams
Migrations: teams, team_members, invoices, activity_events + RLS. Supabase Auth with confirmations disabled (REG-06/08). `register_team()` RPC — transactional uniqueness across name, register numbers and emails, returning field-level violations (ERR-01). Multi-step `/register` (team → 3 members + optional 4th → captain credentials → invoice upload → review) with Zod, preserving completed fields on error. `/register/success` showing the WhatsApp link from settings. `/login`, middleware guards for team/admin. `/admin/teams`: search, inspect, edit, invoice viewer, manual password reset (ADM-02, out-of-scope self-serve reset).
**Verifies** AT-REG-01…05.

### Phase 2 — Public site
Landing from the brochure: hero (BidWave lockup, 17–19 Aug 2026, register CTA), about ("Think Fast. Bid Smart. Build Champions."), six round cards (*The Stat Sprint · Operation Fan Heist · The Immersive Challenge · Crisis Room · The Grand Auction · The Owners' Summit*), day-wise schedule, prizes (admin-editable placeholder), general guidelines, FAQs, contacts (Neha Rani CK, Ankitha, Adith P), Instagram, brochure download, three-logo footer + DOC Analytica credit. `/rounds/[slug]` gated on `public_release`. `/leaderboard` and `/live` shells respecting publication state. Reduced-motion path (UX-05).
**Verifies** PUB-01…08, §6.1.

### Phase 3 — Round engine, submissions, scoring, leaderboards
Migrations: rounds, materials, submissions, submission_files, rubric_criteria, scores, criterion values, stages, qualifications, leaderboard_snapshots, announcements. `effective_round_status()` SQL function + `pg_cron` materializer + admin override + no-reopen trigger. Team classroom dashboard using the exact §8.1 status vocabulary (Upcoming / Open–eligible / Open–view only / Submitted / Closed / Scored). Submission flow: multiple PDF/PPTX/DOCX/XLSX, free replacement until close, server timestamp, download disabled after close (§9.1). Admin: round builder, material upload with per-item public release, submission review + zip download by round/team, total-or-rubric score entry with auto totals, stage aggregation, configurable tie-breakers, manual qualification confirm, explicit Top 15 publish/hide.
**Verifies** RND-01…09, SUB-01…09, SCR-01…07, LDB-01…07, AT-RND-01…03, AT-SCR-01…03, AT-LDB-01.

### Phase 4 — Round 1 quiz
Migrations: questions, options, attempts, answers, events. RPCs `start_quiz_attempt` (per-team order seed, session lock), `save_quiz_answer` (autosave), `advance_question`, `submit_quiz_attempt` (idempotent; weighted scoring), `tick_expired_questions` (server advances timers so a disconnected client cannot stall — QZ-14). Runner: pre-flight rules + explicit confirmation, permission readiness check, locked fullscreen, one question per screen, forward-only, per-question timer ring, autosave on every change, ~3s heartbeat, reconnect banner. Exit detection via `fullscreenchange` + `visibilitychange` + `pagehide` + `sendBeacon` → single auto-submit (QZ-13, ERR-05). Second device gets 409 (QZ-15). Admin: question bank with weights/star and per-question timers, global window, live monitor, exit log. `docs/QUIZ_LIMITATIONS.md` documenting honestly what a browser cannot lock down.
**Verifies** QZ-01…16, AT-QZ-01…05.

### Phase 5 — On-spot simulation
Fully specified — see *Recovered simulation specification* above.

Migrations: `simulation_config` (12 parameter definitions, the 4 correct combinations, sub-score weights, global timer), `simulation_attempts`, `simulation_rewards`. `submit_simulation_attempt()` RPC — evaluates server-side, stamps `clock_timestamp()`, assigns `winner_rank` under row lock, hard-stops at two winners or timer expiry (SIM-07/08/10, AT-SIM-04). Team runner: the 12-section console (8 four-option grids + 4 sliders) re-skinned to BidWave gold-on-black, ANALYZE action, the jersey-7 result panel and seven radial dials, attempt history showing how sub-scores moved across attempts. The six sub-scores are returned; the correct set never is. Admin: start for all qualified teams, global countdown, live attempt feed with server ordering, winner confirmation, reward as marks **or** purse (SIM-11), plus editors for parameters, weights and the answer key.

Bidwave's own 4 combinations are generated at seed time and stored in `simulation_config` — never in client code, never in the repo's committed seed data.
**Verifies** SIM-01…11, AT-SIM-01…04.

### Phase 6 — Auction
Migrations: players, stat definitions, rule sets, purse_ledger, sales, auction_state, record_locks, audit, live_broadcast. CSV/XLSX import: per-row Zod validation, valid rows committed, invalid rows returned as a downloadable report (AUC-05, ERR-09, REP-04). RPCs `record_sale` (locks player + team, validates purse / min-max squad / role caps / overseas limit / pool rules, returns **every** violated rule, writes sale + ledger + audit + broadcast atomically), `reverse_sale` (compensating ledger entry, player status restored, any sale not just the latest), `recall_player`, `set_active_player`, `end_auction`. Optimistic `lock_version` + `record_locks` → conflict warning instead of silent overwrite (AUC-13…16, ERR-07). Admin console built keyboard-first for auction-floor speed, no confirmation friction on routine sales (§24.4). Public `/live`: pools, player statuses, chronological sales/reversal feed, all rosters, purse bars, analytics Locked/Purchased only. Realtime subscription + reconnect-and-refetch fallback (ERR-08, NFR-05). Shortlisted team dashboard: roster, purse with transaction impact, composition and rule compliance, no bidding controls anywhere (TEAM-AUC-05). `end_auction` transforms `/live` into the final squad summary (LIVE-08).
**Verifies** AUC-01…20, LIVE-01…08, TEAM-AUC-01…06, AT-AUC-01…05.

### Phase 7 — Paid analytics
Migration: analytics_requests. `approve_analytics()` — re-checks purse **at approval time**, deducts and unlocks in one transaction, never partially (AN-05, ERR-10). Team: locked tab → request (blocked when funds insufficient, AN-03) → permanently unlocked module. Module (built with the `dataviz` skill): player profiles, head-to-head comparison, role/category recommendations, squad balance and gaps, purse-aware affordable targets, rule warnings, undervalued-player opportunities — every stat degrading gracefully when absent (§17.2). Progressive disclosure for density (§24.4). Admin: set price, request queue, approve/reject.
**Verifies** AN-01…08, AT-AN-01…03.

### Phase 8 — Round 6, final results, exports, hardening
Round 6: instructions, evaluation criteria, each shortlisted team's final squad, configurable rubric, scored as a standalone stage stored separately from earlier aggregates (R6-04, AT-FIN-01). Admin final-result workflow — review order, publish exactly the confirmed Top 10, no hardcoded formula (R6-05, §18 note). Exports: teams, submissions, scores/aggregates/ranks, import errors, sales/reversals/rosters/final squads, activity, auction audit (REP-01…07). Rate limiting on login, registration, quiz submit and simulation attempts (SEC-10). Structured server logging (NFR-12). Full sweep of empty / loading / reconnecting / error / completed states. `npm run seed:demo` — synthetic teams, players and scores, no real student PII, no IPL trademarks (TECH-05). Docs: `README`, `ENV`, `MIGRATIONS`, `DEPLOY` (Supabase + Vercel), `ADMIN_GUIDE`, `BROWSER_SUPPORT`, `QUIZ_LIMITATIONS`. Event rehearsal checklist.
**Verifies** R6-01…06, AT-FIN-01…03, §31.2 definition of done.

---

## Verification

**Automated — Vitest against local Supabase** (`supabase start`, migrations applied, RPCs called directly):
- Sale validation matrix: insufficient purse, max squad, role cap, overseas cap, pool rule — each blocked with **zero** partial writes (AT-AUC-01…03)
- Reversal restores purse, roster, player status and constraint state for a non-latest sale (AT-AUC-04)
- Two concurrent `record_sale` calls on the same player: one commits, one is rejected — never both (AT-AUC-05)
- Analytics approval race: concurrent approvals deduct once and unlock once; approval fails cleanly if purse dropped below price meanwhile (AT-AN-01/02, ERR-10)
- Quiz: two teams get the same set in different orders; starred question applies its weight; answer after server deadline rejected; second device blocked; auto-submit is idempotent (AT-QZ-01…05)
- Simulation: attempts logged with server timestamps; first two correct by server order become winners; a third correct attempt is recorded but wins nothing (AT-SIM-02…04)
- Registration: duplicate register number / email / team name rejected transactionally under concurrency (AT-REG-03/04)
- Scoring: stage aggregates and tie-breakers order correctly; entering scores does not move the public Top 15 (AT-SCR-01, AT-LDB-01)

**Automated — Playwright E2E:** register → login → quiz attempt (incl. fullscreen-exit auto-submit) → Round 2 submission with replacement. Two browser contexts: admin records a sale, public `/live` and the team dashboard both update without refresh. Two admin contexts editing the same player → conflict warning, no overwrite.

**Manual, per phase:** I run the app with the `run` skill and drive it in the browser — landing page at desktop widths, classroom dashboard states, quiz runner, auction console under keyboard-only operation, `/live` during a simulated sale sequence, analytics unlock. Screenshots at each phase demo.

**Pre-event rehearsal:** seed demo data, run all six rounds end-to-end across multiple browser sessions, confirm private files and team data are unreachable by public or by another team, then verify a production-like deploy.

---

## Prerequisites and open inputs

**Needed to start (Phase 0):** Docker Desktop running — it's installed but its daemon is currently stopped. *(Alternative: give me Supabase cloud project keys and I develop straight against the cloud project.)*

**Needed during the build:**
| When | Input |
|---|---|
| Before deploy | Supabase project URL + anon + service-role keys; Vercel project; domain (DEP-10) |
| Before the event | Round briefs/files/rubrics, quiz bank + per-question timers (DEP-03) · WhatsApp link (DEP-04) · player import file with stats (DEP-05) · auction rules: purse, squad min/max, role and overseas limits (DEP-06) · analytics price (DEP-07) · prizes, registration fee and payment instructions, registration deadline, Round 1–2 dates |

Everything in the last row is admin-editable, so none of it blocks development — placeholders ship and get replaced without a code change.

**Action for you, before the event:** unpublish `team-champ-forge.lovable.app` once the Phase 5 rebuild is validated. While it is live, its unauthenticated scoring endpoint lets anyone practise against — and potentially solve — a four-answer puzzle.

**Noted deviations from the PRD, all user-approved:** Sponsors section removed (PUB-01, §4.1). Brochure's IPL franchise flags and trophy not reproduced (§24.2 takes precedence over the brochure's own artwork). SIM-04's "~1,000 combinations" superseded by the prototype's actual 12-parameter space, since SIM-01 makes the prototype the behavioural reference.

**Asset note:** the BidWave logo is a 500×500 PNG — fine for header, footer and badges, thin for a full-bleed hero. I'll compose the hero from a large type lockup with the logo as a supporting mark. An SVG or 2000px+ export would let the mark carry the hero directly.
