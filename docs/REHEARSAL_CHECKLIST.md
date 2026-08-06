# Pre-event rehearsal checklist

Run this full pass at least once before 17 August, ideally with the real
hosted Supabase project (not a throwaway test one), so the rehearsal also
doubles as a production smoke test. Use `npm run seed:demo` beforehand for
realistic volume, or create fresh accounts as you go — either works.

**Sessions needed**: at least 3 concurrent browser sessions/roles — 1 admin,
2+ teams (more teams if you want to rehearse qualification cuts
realistically). Use separate browser profiles or private/incognito windows
so sessions don't share cookies.

## 1. Registration → login

- [ ] Register 2+ new teams via `/register` (3 members each, one 4th
      optional member on at least one team), upload a placeholder invoice.
- [ ] Confirm `/register/success` shows the WhatsApp link from settings.
- [ ] Log in as each team and as the admin at `/login`.
- [ ] Confirm `/admin/teams` shows every registered team; edit one team's
      details and confirm optimistic-concurrency (`p_expected_updated_at`)
      doesn't silently overwrite a concurrent edit.

## 2. Round 1 — Quiz

- [ ] Admin: build the quiz question bank with weights and per-question
      timers under `/admin/rounds/<quiz round>`.
- [ ] Open the round.
- [ ] Both team sessions start the quiz concurrently — confirm each gets
      its own randomized question order and neither can see the other's
      progress.
- [ ] On one team's session, exit fullscreen or switch tabs mid-attempt —
      confirm it auto-submits exactly once (check the exit log in the admin
      quiz monitor).
- [ ] Confirm a second device/tab attempting to start the same team's quiz
      is blocked (QZ-15).
- [ ] Admin publishes scores; confirm teams see them on `/app`.

## 3. Rounds 2–4 — Submissions

- [ ] Upload a file for one round, then replace it before the round closes
      — confirm only the latest file set is "current" and the prior set is
      superseded, not deleted.
- [ ] Close the round; confirm the team can no longer view or replace
      files.
- [ ] Admin scores each round (rubric or flat total), publishes.

## 4. Stage aggregation & qualification

- [ ] `/admin/stages` — wire the correct rounds into each stage's
      "Contributing rounds," with weights.
- [ ] Review standings; manually confirm qualification decisions — confirm
      this never happens automatically from the ranking.
- [ ] Publish the public Top 15 from `/admin/leaderboard`; confirm
      `/leaderboard` shows it and that entering scores earlier never moved
      it by itself.

## 5. Simulation

- [ ] Admin starts the simulation for qualified teams; confirm the global
      countdown is visible to teams.
- [ ] Two teams submit attempts concurrently, including at least one
      correct combination each — confirm exactly two winners are ever
      recorded, in real server-submission order, and a third correct
      attempt (if tested) wins nothing.
- [ ] Admin assigns the reward (marks or purse) and confirms it lands
      correctly (purse case: check the team's ledger at `/app/auction`
      once the auction round exists, or via `admin_apply_pending_simulation_rewards`).

## 6. Auction — the multi-session centerpiece

Run this with the admin console, and both team dashboards, **open and
visible simultaneously**:

- [ ] Admin imports a small player CSV/XLSX; confirm invalid rows come back
      as a downloadable error report while valid rows still commit.
- [ ] Admin grants starting purses.
- [ ] Set a player active; confirm `/live` and both team views show it as
      "on the block" without a manual refresh.
- [ ] Record a sale to Team A — confirm, without refreshing: `/live`'s
      sales feed updates, Team A's `/app/auction` purse/roster update, and
      the admin console's own state updates.
- [ ] Reverse that sale (type a reason) — confirm the player and purse are
      fully restored, and the reversal appears in the public feed as
      struck-through, not removed.
- [ ] Try to violate a rule (insufficient purse, squad cap, overseas cap,
      pool cap) — confirm the sale is blocked and **every** violated rule
      is shown, not just the first.
- [ ] Two admin browser tabs: try to act on the same player from both —
      confirm the optimistic-concurrency check rejects the stale one rather
      than silently overwriting.
- [ ] End the auction; confirm `/live` switches to the calmer final-squad
      summary view for the public, and each team's `/app/auction` still
      shows their full roster/ledger.

## 7. Paid analytics

- [ ] As a team with sufficient purse: request analytics, confirm the
      request appears in `/admin/auction/analytics-requests` in real time.
- [ ] Approve it — confirm exactly one purse-ledger deduction, the team's
      module unlocks without a manual refresh, and `/live`'s badge for that
      team flips to "Purchased."
- [ ] As a second team with insufficient purse: confirm the request button
      is blocked, both client- and server-side.
- [ ] Reject a third team's request with a reason — confirm zero purse
      impact and that the team can request again immediately.
- [ ] Confirm `/live`, viewed logged-out, never shows more than
      Locked/Purchased for any team.

## 8. Round 6 & final results

- [ ] Enter Round 6 (conference) scores per team the same way as Rounds
      2–4.
- [ ] `/admin/stages` — confirm Round 6's round is wired only into the `r6`
      stage, never `final`, and that `final`'s aggregate is unaffected by
      it.
- [ ] `/admin/final-results` — review the side-by-side final-stage
      aggregate and Round 6 score for every team, build the explicit Top
      10 array, publish it.
- [ ] Confirm `/leaderboard` shows the published Final Top 10 publicly.

## 9. Exports

- [ ] Download every export kind from `/admin/exports`; open each file and
      spot-check row counts and a few values against what you just did
      above (e.g. the sales export should contain the sale + its reversal
      from step 6; the import-errors export should contain the CSV row you
      deliberately broke in step 6).

## 10. Abuse protection

- [ ] Script (or manually spam) more than the allowed number of quiz-submit
      or simulation-attempt calls in the test window — confirm the
      rate limiter rejects the excess calls with a friendly message, and
      that a `rate_limit_exceeded` line appears in the server logs.

## 11. Cross-cutting checks

- [ ] Every screen above that has a live subscription: briefly disable your
      network connection and confirm a visible "reconnecting"/"offline"
      banner appears, then confirm it recovers once the network is back.
- [ ] Confirm private data never leaks: a team's own `/app/**` pages never
      show another team's roster/purse/analytics detail; only the curated
      public views appear on `/live`.

## 12. Cleanup

- [ ] Delete every QA/rehearsal team, player, sale, and ledger entry
      created above, following `docs/ADMIN_GUIDE.md`'s cleanup steps.
- [ ] Re-run `npx vitest run` once more after cleanup to confirm the schema
      and grants are still intact.
