# Bidwave — post-QA fix pass 2 (confidence report)

Same format as `TESTING_GUIDE.md`: what changed, how it was verified, and how confident
the result is — rated against what was actually exercised, not just "the code looks
right."

**Confidence key**
- **High** — exercised directly (live browser click-through, a direct RPC/SQL check
  against the hosted DB, or covered by the automated test suite run on a clean DB).
- **Medium** — code was reviewed and type-checked/linted cleanly, and often loaded once
  in the browser to confirm no crash, but the specific interaction (a live two-tab sync,
  a keyboard-focus ring, a fast-flashing skeleton) wasn't separately exercised.

---

## 1. Simulation completely empty — **High confidence** (Priority 1)

**Root cause, not just a symptom fix:** `simulation_config` had zero rows for the active
edition. `npm run unseed:demo` correctly deletes it (to cascade away test attempts), but
`seed:demo` never recreated one — the only INSERT was a one-time migration guarded by
`not exists`, so it could never re-fire. A second, deeper bug was found once a config
existed: the original placeholder's `parameters`/`scoring`/`answer_key` JSON shape never
actually matched what `simulation-console.tsx` (frontend) or `simulation_evaluate()`
(backend) require — visiting `/app/simulation` as a team threw `parameters.categorical.map
is not a function` the moment a row existed.

**What changed:**
- `scripts/seed-demo.cjs` now restores a correctly-shaped `simulation_config` row every
  run, via the real `admin_save_simulation_config()` RPC (not a raw INSERT) — the same
  calibration check ("all-defaults must evaluate to exactly 70") production goes through.
- New migration `supabase/migrations/20260802010000_fix_simulation_config_placeholder_shape.sql`
  fixes any existing row with the old broken shape, and fixes a genuinely fresh
  deployment that never ran `seed:demo`.

**Verified:** ran `npm run unseed:demo && npm run seed:demo` twice, confirming the row is
restored every time. Logged in as admin, clicked "Show to teams" and "Start" — both
worked, toasts confirmed. Logged in as a team, `/app/simulation` rendered the full 4×4
categorical grid + 4 sliders with correct labels (not a 404, not a crash). Submitted a
real attempt with the RPC round-trip — scored **exactly 70**, matching the calibration
design. `tests/simulation.test.ts` (winner ordering, calibration rejection) passes on a
clean DB.

---

## 2. Auth flow fixes — **High confidence**

- **Back link on `/login` and `/register`:** added, using the existing `BackLink`
  component. Confirmed rendering and `href="/"` on both pages.
- **Sign-out redirect:** `src/lib/auth-actions.ts` changed from `redirect("/login")` to
  `redirect("/")`. Verified for both a team session and an admin session — both now land
  on the public homepage with logged-out nav (Login/Register), not `/login`.
- **Registration → login flow:** investigated and **found already correct** —
  `register/actions.ts` redirects to `/register/success`, which links to `/login`, and
  `proxy.ts` independently blocks an unauthenticated `/app` visit. No code change needed
  here; what you reported doesn't match what's in the code now. The full wizard
  click-through (team name → campus → members → captain credentials → invoice →
  submit) was not completed live this session — an unrelated shadcn `Select` component
  (campus dropdown) didn't respond reliably to scripted clicks in this browser-automation
  environment (a tooling quirk, not a code issue — the same component works via the
  admin team-editor elsewhere in this session). Recommend a quick manual click-through
  to fully close this out.

---

## 3. Cursor affordance + transition timing — **High confidence**

- `Button` component now shows `cursor: pointer` (confirmed via computed style) and
  `cursor: not-allowed` when disabled.
- Three raw `<button>` elements (quiz options, simulation categorical options, team-name
  link) got the same fix.
- Page transition: `AnimatePresence mode="wait"` → `mode="popLayout"` with a plain
  crossfade — removes the serialized 360ms exit-then-enter delay. Confirmed the app
  still navigates cleanly across dozens of route changes this session with no visual
  breakage; the improvement itself is a timing change, not something screenshot-diffable.
- Two hard-reload `<a>` tags found and fixed (`admin/activity`'s "Exports" link, and one
  found opportunistically in `rounds-table.tsx`'s round-title link) — confirmed via
  network request showing a `?_rsc=` soft-navigation fetch instead of a full document
  reload.

---

## 4. Loaders — **Medium confidence**

Added `loading.tsx` (using the existing `Skeleton` primitive, now actually used) for
`admin`, `admin/teams`, `admin/rounds`, `admin/auction/console`, `app`, and `(public)`.
Confirmed each route still loads with no errors. The skeleton itself renders too briefly
on a fast local dev server to catch mid-flight in a screenshot — structurally verified,
not visually caught in the act.

---

## 5. Admin realtime broadcast coverage — **High confidence**

Extended `broadcast_live()` (defined once, used by only 3 of ~14 admin routes before) to
teams, round lifecycle, leaderboard, stages, announcements, and simulation — one new
migration, `20260802020000_admin_broadcast_topics.sql`. Three functions moved from
`language sql` to `language plpgsql` to make the insertion point unambiguous — same
logic, same errors.

**Verified:** ran `admin_upsert_round`, `admin_publish_leaderboard`, and
`admin_set_stage_rounds` directly against the hosted DB and confirmed the expected
`live_broadcast` row appeared each time. Also clicked "Open now" on a round in the real
admin UI and confirmed the `rounds` / `lifecycle_open_now` broadcast fired from that
click specifically (not just from the direct RPC test).

---

## 6. Admin client-data rewrite (React Query) — **High confidence for what shipped; scope noted below**

Added `@tanstack/react-query`, a `QueryClientProvider` in the admin shell, and a shared
`useAdminLiveQuery` hook (query cache + realtime-topic invalidation in one call).
Converted **6 routes** end to end: **teams, rounds, leaderboard, stages, simulation,
announcements**. Each keeps its existing mutation UI but now also invalidates its query
on the admin's own successful action (instant reflection) and on the matching
broadcast_live() topic (cross-session reflection).

**Verified live, with two browser tabs open on the same admin session:** clicked "Open
now" on a round in tab A — tab B updated to show **OPEN** with zero interaction in that
tab. This is the core "no-reload, auto-synced" behavior you asked for.
Also verified a mutation's own instant reflection (publish/unpublish an announcement —
toast + status flip with no page reload) and confirmed via `getAnimations()`/network
inspection that no full navigation occurred.

**A real bug found only through this live testing, not by reading code:** two components
(`announcement-panel.tsx`, `leaderboard-publisher.tsx`) had a pre-existing hydration
mismatch — `new Date(x).toLocaleString()` with no explicit locale, which renders
differently server-side (Node's locale) vs. client-side (browser's locale). This is the
same bug class already fixed once elsewhere in the codebase (`console-sales-log.tsx`),
just never applied here. Fixed in those two files plus two more with the identical
pattern (`simulation-admin.tsx`, `team-detail-sheet.tsx`, `quiz-builder.tsx`) —
confirmed no new hydration errors in the dev log after the fix. **Two more occurrences
in team-facing `/app` pages were out of this pass's scope and flagged as a follow-up
task**, not silently left broken.

**Scope note, stated plainly:** `auction/players`, `auction/rules`, `auction/analytics`,
and `final-results` were **not** converted to React Query this pass — they remain plain
server-rendered pages (still get the Phase 2/3 fixes: cursor, transitions, loaders).
`auction/console`, `analytics-requests`, and `activity` already had live-sync from before
this session (a `router.refresh()`-based pattern, not React Query) and were left as-is.
`exports` needs no changes — it's a static list of file-download links, correctly using
plain `<a>` tags since those hit an API route, not an app page. This was a deliberate
stopping point given the size of a full 14-route conversion, not an oversight.

---

## 7. Bundled light polish — **High confidence**

- Button hover/press feedback: `shadow-sm hover:shadow-md` plus a `scale-[0.98]` press
  state. Confirmed via computed `boxShadow`.
- Focus-visible rings added to the public nav and admin sidebar links (previously
  invisible to keyboard-only navigation) — added, not separately tab-key-tested live
  (**Medium** for this specific item).
- One subtle Broadcast-mood accent: the homepage tagline ("Think Fast. Bid Smart. Build
  Champions.") now pulses gently, gated behind `prefers-reduced-motion`. Confirmed the
  CSS animation is actually running via `getComputedStyle(...).animationName === "pulse"`.

---

## Test suite — **High confidence**

`npm test` (Vitest, 81 tests across 11 files) passes 100% on a freshly unseeded DB.
Running it against `seed:demo`-populated data throws unrelated unique-constraint
collisions (the tests assume a clean slate, same class of issue `TESTING_GUIDE.md`'s
unseed-script work already documented) — not a regression, confirmed by re-running clean.
No Playwright config exists in the repo despite being named in `CLAUDE.md`'s stack list;
there was no e2e suite to run, so live browser click-throughs (documented above) served
that role this session.

## What to check yourself

- The registration wizard's campus dropdown, end to end (noted in §2 above) — the one
  thing this session's own tooling couldn't reliably click.
- Keyboard-only Tab navigation through the public nav and admin sidebar, to see the new
  focus rings.
- The skeleton loaders, on a throttled connection (they're real, just too fast to catch
  on localhost).
