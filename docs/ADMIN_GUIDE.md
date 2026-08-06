# Admin guide

The operational workflow for running a Bidwave event, round by round.

## Settings & content

`/admin` → most public-facing copy (prizes, FAQs, contacts, registration fee,
WhatsApp link, Instagram) lives in the `settings` table and is editable
without a code change — check the settings editor screen for the current
list of keys.

## Round-by-round workflow

For each round (`/admin/rounds`):

1. **Build the round**: title, brief, instructions, kind
   (quiz/submission/offline_info/simulation/auction/conference), sequence.
2. **Upload materials**: per-item, choose whether it's publicly releasable
   (shown on the public `/rounds/[slug]` page) or team-only.
3. **Open the round**: either let its `opens_at`/`closes_at` window take
   effect automatically, or use the one-way admin override
   (`opened_early_at`/`closed_at` — these can only move a round *forward*,
   never re-open a closed one).
4. **Rubric** (submission/conference rounds): add rubric criteria with max
   values and weights under the round's Rubric tab.
5. **Score entry**: enter scores per team under the round's Scores tab
   (either a flat total or per-criterion values that auto-sum). Publish
   scores explicitly — entering a score never makes it visible to the team
   or moves any public leaderboard by itself.

### Quiz rounds specifically

Question bank (prompt, options, weight, per-question timer) is managed
under the round's Quiz bank tab. There is no "advance question" button — the
lockstep schedule advances automatically once a round opens. See
`docs/QUIZ_LIMITATIONS.md` for what a browser genuinely cannot lock down
during a quiz attempt, and the live monitor / exit log for visibility into
that.

### Simulation round

`/admin/simulation` — start for all qualified teams, watch the global
countdown and live attempt feed, confirm winners, assign the reward as
marks or purse. Parameters, sub-score weights, and the answer key (the four
correct combinations) are editable there too — **never commit real answer
combinations to the repo**; they're generated fresh per event and stored
only in `simulation_config`.

### Auction round

`/admin/auction/players` (import via CSV/XLSX — invalid rows come back as a
downloadable error report, valid rows commit regardless), `/admin/auction/rules`
(purse, squad/role/overseas/pool limits, analytics price — then "Grant
starting purses" once, and "Apply pending simulation rewards" as winners are
confirmed), `/admin/auction/console` (the live sale-entry screen — one click
to record a sale, no confirmation; reversing a sale requires a typed reason).

### Round 6 (The Owners' Summit / conference)

No separate admin screen — it's an ordinary round like any other
(`kind = 'conference'`). Open `/admin/rounds/<its id>`, add materials/
instructions and rubric criteria, and enter scores per team the same way as
Rounds 2–4. Its score is deliberately **standalone**: it only affects the
`r6` stage's standing (see below), never automatically folded into the
`final` stage.

## Stages, qualification & the round-weight editor

`/admin/stages` — one panel per stage (`r1_r2`, `r3_r4`, `r6`, `final`).
Expand **"Contributing rounds"** on any stage panel to choose which rounds
feed that stage's aggregate and at what weight — this is what keeps Round
6's score isolated (its round is wired only into the `r6` stage, never
`final`). After configuring weights, the standings table shows each team's
rank/aggregate; manually confirm qualification decisions per team — this is
never automatic from the ranking.

## Leaderboard vs. Final results

- `/admin/leaderboard` publishes the public **Top 15** — an admin-ordered
  array of team/score entries, never computed by the page itself.
- `/admin/final-results` is where the **Final Top 10** is reviewed and
  published: it shows each team's final-stage aggregate side by side with
  their standalone Round 6 score (and every stage's qualification decision
  for context) so the admin can build the ranked array with full
  information — there is deliberately no auto-computed "combined score"
  treated as authoritative.

## Exports

`/admin/exports` — download teams, submissions, scores/aggregates/ranks,
player-import error history, sales/reversals/rosters/final-squads, the
activity log, and the auction audit trail. Each is a real file download
(CSV or multi-sheet XLSX), not a screen to read on-site.

## Announcements

Post a short announcement visible on every team's dashboard — use for
schedule changes, round openings, or urgent corrections.

## Monitoring abuse & health

Rate limits (SEC-10) are already enforced server-side on login,
registration, quiz start/submit, and simulation attempts — a team hitting
one sees a friendly "please wait" message, not a crash. Rate-limit
rejections and RPC failures are logged as structured JSON lines (see the
app's server logs / Vercel log drain) under events `rate_limit_exceeded` and
`rpc_error` — useful during the event if something looks stuck.

## Cleaning up QA/test data

Before the real event, delete any QA fixtures created during rehearsal or
testing:

1. Delete the QA teams' `team_members`, `teams` rows (in that order, for
   the FK).
2. If they had any purse ledger entries: temporarily
   `alter table public.purse_ledger disable trigger purse_ledger_append_only;`,
   delete the rows, then re-enable the trigger — the table's own
   append-only guard blocks ordinary deletes otherwise, even for the
   `postgres` superuser role.
3. Delete their `auth.users` rows via the Supabase dashboard or the Admin
   API (`auth.admin.deleteUser`).
4. Re-run `npx vitest run` to confirm the schema/grants are still intact
   after the cleanup.
