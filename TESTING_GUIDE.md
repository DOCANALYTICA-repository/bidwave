# Bidwave QA fixes — tester guide

This covers the 18 items from the last manual QA pass. For each one: what
changed, how to check it yourself, what you should see, and how confident
the implementation is — rated against what was actually verified during
development, not just "the code looks right."

**Confidence key**
- **High** — exercised directly (an automated script/RPC call actually ran
  it and the result was checked), or covered by the automated test suite.
- **Medium** — code was reviewed and type-checked/linted cleanly, but not
  clicked through in a live browser during this session (the screenshot
  tool was unavailable this session — text/DOM-based checks were used
  instead where possible).

Before testing, get a clean slate:
```bash
npm run unseed:demo   # wipes all test data for the active event edition
npm run seed:demo     # re-seeds demo teams/players if you want fixtures
npm run dev            # starts the app at http://localhost:3000
```

---

## 1. "Powered by DOC Analytica" branding — **High confidence**

**What changed:** Consolidated into one shared component, reworded from
"Built by", and enlarged (logo roughly doubled) everywhere it appears —
public site footer, admin sidebar, the analytics module, and newly added
to the participant `/app` shell (including round 5's auction dashboard,
which previously had no credit at all).

**How to check:** Visit the homepage and scroll to the footer — bottom
right should say "Powered by" next to the DOC Analytica logo, larger than
before. Log in as a team and check the bottom of every `/app/*` page
(including the auction page) for the same credit. Log in as admin and
check the bottom of the left sidebar.

**Verified:** measured directly via browser DevTools — logo grew from
16px→32px tall in the footer, 24px→40px in the admin sidebar; confirmed
present on `/app` pages where it didn't exist before.

---

## 2. Page transition animations — **Medium confidence**

**What changed:** A subtle fade/slide plays when navigating between pages
on the public site, participant app, and admin panel. Respects your
system's "reduce motion" setting (turns off automatically if you have that
enabled).

**How to check:** Click between nav links (e.g. Home → Rounds → Schedule)
and watch for a brief fade-in. Try it with "reduce motion" turned on in
your OS accessibility settings — the transition should disappear entirely,
not just get faster.

**Not yet verified:** the animation itself wasn't visually confirmed in a
live browser this session (a tooling issue prevented screenshots) — code
compiles and type-checks cleanly, and the pattern matches how `motion` is
already used elsewhere in the app, but please actually watch it play.

---

## 3. Admin can reverse actions — **High confidence**

**What changed:** Four new reversible actions, each requiring a typed
reason before it's allowed:
- **Reopen a closed round** (Admin → Rounds → a closed round → "Reopen…").
  Also resets scoring/publish state on that round so it returns to a
  clean "open" state.
- **Restart a stopped simulation** (Admin → Simulation → "Restart…",
  appears once the simulation is stopped). Starts a fresh timer; past
  attempts are kept, not deleted.
- **Reverse a simulation reward** (Admin → Simulation → reward list →
  "Reverse…"). Removes the marks/purse grant; refunds the purse if it had
  already been applied.
- **Revoke an analytics approval** (Admin → Auction → Requests → an
  approved request → "Revoke…"). Refunds the purse.

Auction sale reversal already existed and is unchanged.

**How to check:** Try each action from its admin page above. Confirm the
"Confirm" button stays disabled until you type a reason. After confirming,
refresh and verify the state actually changed (round shows open again,
simulation timer restarted, reward/purse entry gone or refunded, request
shows "revoked").

**Verified:** each of the four RPCs was executed directly against the
database (bypassing the UI) with before/after checks — reopen correctly
cascades and logs an audit entry, restart resets the timer and blocks
restarting a simulation that isn't stopped, reward reversal produces the
exact expected purse-ledger correction and removes the reward row, and
revoke refunds the exact charged amount and blocks revoking twice. The
admin UI wiring around these RPCs was code-reviewed but not click-tested.

---

## 4. Back button on relevant pages — **Medium confidence**

**What changed:** Added a "← Back" link to pages that previously had no
way back except browser history: the admin round workspace, a participant's
round page, the on-spot simulation page, and the "submitted" screens after
finishing a round/quiz/simulation.

Deliberately **not** added to the quiz-taking screen itself — that lockdown
is intentional anti-cheat behavior, not an oversight.

**How to check:** Open any round as a team or admin and look for the back
link near the top. Submit a quiz and check the "Submitted" screen has a
"Back to dashboard" link.

---

## 5. Register → login flow — **Medium confidence**

**What changed:** Completing registration no longer logs you in
automatically. You now land on a confirmation page and must log in
separately, same as any returning team.

**How to check:** Register a brand-new team through `/register`. On the
confirmation page, click "Log in to your dashboard" — you should land on
the **login page**, not the dashboard directly. Open a private/incognito
window and try visiting `/app` right after registering — you should be
redirected to login, not shown the dashboard.

---

## 6. Edit added quiz questions — **Medium confidence**

**What changed:** Each question in the admin quiz builder now has an
"Edit" button (next to "Delete") that loads the question back into the
form for editing, including its options and correct answer.

**How to check:** Admin → Rounds → a quiz round → add a question, then
click "Edit" on it, change the prompt, and save. Confirm the question list
shows your edit, not a duplicate.

---

## 7. Hide simulation by default, admin reveals — **High confidence**

**What changed:** The on-spot simulation page is now hidden from teams by
default (visiting it shows a 404) until an admin explicitly clicks "Show
to teams." This is independent of Start/Stop — an admin can reveal it
without starting the clock, and hide it again without affecting
started/stopped state.

**How to check:** As a team, before an admin has revealed anything,
`/app/simulation` should 404 and the dashboard shouldn't show a
"simulation" link at all. As admin, go to Admin → Simulation and click
"Show to teams" — the team dashboard link and page should now appear/work.
Click "Hide from teams" and confirm it disappears again, regardless of
whether Start/Stop has been touched.

**Verified:** the underlying reveal/hide toggle was executed directly
against the database and the `visible_at` flag was confirmed changing
independently of started/stopped state. The team-facing gating
(404/dashboard link) was code-reviewed, not click-tested.

---

## 8. UX after round/quiz/simulation submission — **Medium confidence**

**What changed:** Submitting a round's files, a quiz, or a simulation
attempt now shows a toast confirmation (not just a static message) and,
for quiz/simulation, a "Back to dashboard" link so you're not stranded.

**How to check:** Submit each of the three and confirm a toast pops up in
the corner and there's an obvious next step, not just static text.

---

## 9. Registration under load (~100 at once) — **High confidence**

**What changed:** The per-IP registration rate limit was raised from
8/hour to 60/hour, so a burst of legitimate registrations from one shared
network (e.g. campus WiFi) won't get falsely blocked. The database layer
itself was already fine at this scale.

**Verified:** an automated script (`npm run load-test:registration`) fired
100 fully concurrent registrations directly against the database/auth
backend. Result: **100/100 succeeded**, ~6.7 seconds total, no orphaned
accounts or files on failure. Run it yourself:
```bash
npm run load-test:registration    # defaults to 100
npm run unseed:demo               # clean up afterward
```

---

## 10. Quiz under load (~400 at once) — **High confidence (with a caveat)**

**What changed:** Investigated and found the quiz engine itself has no
structural bug — the timer is already server-computed with a cron
backstop, and each team gets an independently shuffled question order (an
intentional anti-cheat measure, not a flaw).

**Verified:** an automated script (`npm run load-test:quiz`) registers N
teams then fires the full start→get-state→submit RPC sequence for all of
them concurrently. **Every quiz flow that got a team registered succeeded
(100%)**, at 260–400+ RPC calls/second with each full flow completing in
under 3 seconds.

**Caveat found along the way:** at very high *literally-simultaneous*
concurrency (300+ at once), **team registration itself** started hitting
timeouts from Supabase's own Auth Admin API (not Bidwave's code, not the
database) — confirming the original suspicion that Auth/Storage API limits
would bite before the database would. In practice, real registrations
trickle in from separate people over minutes, not literally the same
instant, so this is unlikely to matter for the actual event — but if
you're doing a real dress-rehearsal load test, register teams in a few
batches rather than one giant burst. The quiz engine itself was not the
bottleneck at any point.

```bash
npm run load-test:quiz            # defaults to 400
npm run unseed:demo               # clean up afterward
```

---

## 11. View submitted docs after round closed — **Medium confidence**

**What changed:** Two different things were going on here:
- While a round is **open**, teams previously saw only the filename of
  what they submitted with no way to actually open it. Fixed — it's now a
  real download link.
- Once a round is **closed**, viewing is still blocked by design (this
  matches the product spec, confirmed intentional, not a bug) — that part
  is unchanged.

**How to check:** As a team, submit a file to an open round, then reload
the page — the filename should now be a clickable download link. Once the
round closes, it should go back to "Submission is closed" text (this is
expected, not a bug).

---

## 12. Simulation error — **Medium confidence**

**What changed:** Previously, any unexpected server error during a
simulation submission was silently discarded and replaced with a generic
"Could not submit" message — with nothing logged anywhere, making it
undiagnosable. Now the raw error is logged server-side before falling back
to the generic message (same fix applied to the quiz submission path,
which had the identical issue). Also scoped the simulation page's config
lookup to the active event edition explicitly, removing an edge case where
a second config row could cause confusing mismatches.

**How to check:** This is primarily a diagnosability fix, not a
user-visible behavior change — if a submission still fails for a real
reason (e.g. simulation not started), you'll see the same specific message
as before. The difference only shows up in server logs, which a tester
won't normally see.

---

## 13. Team constraints always visible during auction — **Medium confidence**

**What changed:** The **participant-facing** auction page already showed
squad-size/overseas-limit compliance at all times (this was already
correct). The gap was on the **admin console** — it had no visibility into
a team's roster constraints before recording a sale, only a raw error dump
after a rejected one. Fixed: selecting a team in the console now shows its
squad size, overseas count, and role/pool breakdown against the active
rule set immediately.

**How to check:** Admin → Auction → Console, select a team from the
dropdown — a "Team constraints" box should appear showing squad
size/overseas count against the limits, before you enter an amount.

---

## 14. Round 5 (auction) scoring removed — **Medium confidence**

**What changed:** The Rubric and Scores tabs no longer appear on the
auction round's admin workspace — auction is scored via purse/roster
rules, not a manual rubric, so those tabs never made sense there.

**How to check:** Admin → Rounds → open the auction round (round 5) — you
should see only a "Materials" tab, no "Rubric" or "Scores" tab. Any other
round kind should still show its normal tabs.

---

## 15. Scoring rejects numbers like 5 and 20 — **Medium confidence**

**What changed:** Root cause turned out to be a per-criterion maximum
value silently blocking the browser's native form validation with zero
visible feedback — not a regex bug as originally suspected. Fixed by
replacing that with an explicit check that shows a real error message
(e.g. "Max for this criterion is 10") instead of just doing nothing.

**How to check:** Admin → Rounds → a submission-round with rubric
criteria → Scores tab. Try entering a score above a criterion's stated
max (shown next to its label now) — you should see a clear error message,
not the form just refusing to submit silently. Entering a value within
range (including round numbers like 5 or 20) should save normally.

---

## 16. Success/confirmation messages for all actions — **Medium confidence**

**What changed:** A broad sweep adding toast confirmations across
registration, admin round/team/quiz/player/announcement/leaderboard/
simulation/analytics actions, and round/quiz/simulation submissions —
previously most of these had either no feedback or only text that could
be easy to miss.

**How to check:** Try a representative sample: save a round, add a rubric
criterion, publish an announcement, reverse a sale, confirm a simulation
reward, approve/reject an analytics request. Each should produce a toast
in the corner of the screen, success (green) or error (red) as
appropriate.

---

## 17. Unpublished scores on live leaderboard — **No change needed**

**Investigated and did not reproduce.** The public leaderboard only ever
reads from immutable, admin-published snapshots — there is no code path
by which an individual team's unpublished score reaches it. This item was
a false alarm; nothing was changed.

---

## 18. Unseed doesn't fully reset — **High confidence**

**What changed:** The demo-reset script was rewritten to do a genuine
full reset for the active event edition: round lifecycle timestamps,
quiz/simulation attempts and content, analytics requests, audit/activity
logs, rate-limit counters, orphaned storage files, and — since everything
in the hosted dev database right now is test data — every team
(previously only ones with a `@test.bidwave.local` email were cleared,
so a team registered through the real form during manual testing used to
survive and quietly corrupt things).

**Verified extensively** — this was run dozens of times during development
of the other fixes above, and two real bugs were caught and fixed in the
process:
1. A foreign-key ordering bug that made the *old* script fail outright
   whenever an analytics request existed.
2. A pagination bug where the cleanup only ever looked at the first ~50
   accounts, silently leaving hundreds of test accounts behind at scale —
   found via the load tests above, now fixed and confirmed clean at 315
   accounts in one run.

**How to check:**
```bash
npm run seed:demo
npm run unseed:demo
```
Should complete with no errors and report how many accounts were deleted.
Re-running immediately after should report 0 to delete (nothing left over).

---

## Also changed, not in the original list

- **D1/D2 — scale hardening**: registration rate limit raised (see item 9);
  the admin Teams list now paginates (25 per page) instead of rendering
  every row at once, while search still searches the full list.

## What to do if something looks wrong

Every item above notes its confidence level honestly — anything marked
**Medium** was reviewed in code and passed automated type/lint checks, but
wasn't clicked through in a live browser this session. If you find a
regression in a Medium-confidence item, that's exactly the kind of thing
this guide expects you to catch — please report it with the exact steps
you took.
