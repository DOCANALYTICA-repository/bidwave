# Quiz runner — honest limitations

The PRD (§10.2) is explicit: a browser cannot provide an absolute kiosk lock on an
uncontrolled personal device. This document says plainly what Bidwave's Round 1 quiz
runner does and doesn't actually prevent, so nobody mistakes "logged and auto-submitted"
for "impossible."

## What is enforced server-side (cannot be bypassed by the client)

- **Timing.** Once a team starts, every question's window is `started_at + prefix-sum of a
  snapshotted timer array` — a pure function of the database clock. The client never tells
  the server which question it's on; `get_quiz_state()` always recomputes the index from
  `now()`. A team cannot extend a question's time by manipulating its own clock, pausing
  JS execution, or editing request payloads.
- **One attempt, ever.** `quiz_attempts` has a unique index on `(round_id, team_id)` for
  every non-archived row — a second concurrent `start_quiz_attempt()` call fails at the
  database level, not just in application logic (QZ-15).
- **Scoring.** Correct answers (`quiz_options.is_correct`) are never sent to the browser
  under any role. `submit_quiz_attempt()` computes the weighted score server-side and is
  idempotent, so a duplicate submit (beacon racing the Submit button) can't be replayed for
  a different result.
- **Late entry.** `start_quiz_attempt()` refuses to start a fresh attempt if less time
  remains before the round closes than the full schedule needs — a team can't get a
  legitimately shorter, non-comparable attempt.

## What is detected and logged, but not prevented

- **Leaving fullscreen.** The runner requests fullscreen on start and listens for
  `fullscreenchange`. If the browser exits fullscreen (Esc key, OS gesture, a second
  monitor's window manager), the runner immediately calls `submit_quiz_attempt(reason:
  'fullscreen_exit')`. A team *can* exit fullscreen — the browser has no API to prevent
  it — but doing so ends the attempt.
- **Tab switching / window loss of focus.** Detected via the Page Visibility API
  (`visibilitychange`). A team switching to another application is logged and
  auto-submitted the same way. A determined team could still glance at a second physical
  device without ever touching this browser tab or window — that's outside what any web
  page can observe.
- **Closing the tab or navigating away.** Detected via `pagehide`, which fires reliably
  enough to get one `navigator.sendBeacon()` call out before the page is torn down. Unlike
  the other two signals, this cannot go through a Server Action (sendBeacon can only POST
  to a real URL), so it hits a dedicated Route Handler (`/api/quiz/submit`) instead.
- **A crashed browser or lost network with no graceful exit event.** None of the above
  fires. The attempt sits `in_progress` until either (a) the team returns and the schedule
  naturally reaches its end, producing a `time_expired` state that the client itself
  auto-submits as `'completed'`, or (b) `tick_quiz_attempts()`, a `pg_cron` job running
  every minute, finalizes any attempt whose `scheduled_ends_at` passed more than 30 seconds
  ago. This is a backstop, not a live detector — a team that never returns can be up to
  ~90 seconds stale in the admin monitor.
- **Client-side same-tab navigation.** Clicking a link elsewhere in the app shell (e.g. the
  "Sign out" button in the shared `/app` header) during an active attempt does not fire
  `visibilitychange`, `fullscreenchange`, or `pagehide` if Next.js can serve it as a
  client-side transition without a full page unload. This is closed via a small exit guard
  (`src/lib/quiz-exit-guard.ts`): `QuizRunner` registers a "finish the attempt first"
  callback while `phase === 'in_progress'`, and the Sign-out button awaits it before calling
  `signOut()`. Note this is *not* an unmount-cleanup effect — an early version of this fix
  tried that, and live testing caught a real bug: `signOut()`'s Server Action clears the
  Supabase session server-side before the client-side redirect/unmount ever happens, so a
  `submit_quiz_attempt` call fired from unmount cleanup runs unauthenticated and silently
  fails. Running the guard *first*, before sign-out proceeds, avoids that race. This closes
  today's one known link; a nav link added elsewhere in the shell later would need the same
  `runQuizExitGuard()` call before it navigates.
- **The browser's native back/forward button.** This is the same class of gap as the item
  above — a back/forward route swap fires no `visibilitychange`/`fullscreenchange`/`pagehide`
  either — just triggered by browser chrome instead of an in-app link, so the exit-guard
  pattern above doesn't cover it (there's no click to run the guard before). Closed directly
  in `QuizRunner`'s exit-detection effect instead — but *not* via a `popstate` listener, which
  was tried first and confirmed broken by direct reproduction: on Chromium, Next 16's App
  Router intercepts back/forward via the Navigation API (`window.navigation`'s `navigate`
  event) and completes its route swap — unmounting `QuizRunner` and running this effect's
  cleanup, which removes the listener — *before* the browser dispatches the legacy `popstate`
  event to `window` listeners at all. A `popstate` handler here is reliably gone by the time
  `popstate` itself fires. The fix listens for the Navigation API's `navigate` event instead
  (checking `navigationType === 'traverse'`), which fires synchronously to all listeners
  before the intercepting listener's async work (an RSC fetch) resolves, so the component is
  still mounted when it runs — falling back to `popstate` on browsers without the Navigation
  API (Firefox, Safari as of writing — see `docs/BROWSER_SUPPORT.md`), where Next can't
  intercept this way either and the ordering problem doesn't arise. Safe as plain
  fire-and-forget here, unlike
  the Sign-out case — native back-navigation never clears the auth session first, so there's
  no race to guard against.

## What is explicitly not attempted

- **A second physical device.** Nothing on the web platform can detect that a team member
  is looking up an answer on their phone. `QZ-15`'s "one active session" guarantee is about
  the *quiz attempt*, not about human behavior in the room.
- **Developer tools / network interception.** A team with devtools open can read (but not
  usefully act on) the `get_quiz_state()` response, since it never includes `is_correct`.
  They cannot forge a correct answer without knowing which option id is correct, and the
  server re-validates every `save_quiz_answer()` call against the question's actual window.

## Practical takeaway for admins

Every exit event is timestamped in `quiz_events` and visible on request. Use the admin
"Reset attempt" action (`admin_reset_quiz_attempt`) only for genuine hardware/venue
failures reported by the team in the room — it archives the stuck attempt and grants one
fresh, re-randomised attempt. It is a fairness escape hatch, not a routine control.
