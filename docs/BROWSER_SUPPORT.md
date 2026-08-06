# Browser support

## Supported browsers

Bidwave targets current desktop browsers for admin/console use, and current
desktop + mobile browsers for the public site and team dashboard:

- Chrome/Edge (Chromium) — latest 2 versions. Primary target for the
  auction console and quiz runner (Fullscreen API support is most reliable
  here).
- Firefox — latest 2 versions.
- Safari (macOS + iOS) — latest 2 versions. See the Fullscreen API caveat
  below — this is the browser where quiz lockdown is weakest.

No support target for Internet Explorer or legacy Edge (EdgeHTML).

## Known limitations

### Fullscreen API (quiz runner, `/app/quiz/[roundId]`)

- `document.documentElement.requestFullscreen()` is a **best-effort**
  action, not a guarantee (§10.3) — some browser/OS/automation contexts
  never resolve or reject the returned promise at all (no user-gesture
  dialog to answer), and the quiz start sequence deliberately doesn't block
  on it for that reason.
- **iOS Safari does not support the Fullscreen API for arbitrary elements**
  at all as of this writing — a team on an iPhone/iPad will start the quiz
  in normal (non-fullscreen) browser chrome. The exit-detection listeners
  (`visibilitychange`, `pagehide`) still work and still auto-submit on a
  tab switch or app backgrounding, so the round's integrity holds even
  without the fullscreen lock itself.
- See `docs/QUIZ_LIMITATIONS.md` for the full, honest list of what a browser
  cannot lock down during a timed attempt, and why — this is intentionally
  not oversold to the department.

### Mobile support statement

- Public site, registration, team dashboard, and the analytics module are
  fully responsive and expected to work on mobile browsers.
- The **quiz runner** and **auction console** are usable on mobile but are
  designed and tested primarily for desktop/tablet — recommend teams take
  the quiz on a laptop where possible, and the admin always runs the
  auction console from a desktop browser (§24.4's "keyboard-first" design
  assumes a physical keyboard).
- The **simulation console**'s slider controls work with touch but are
  easiest to use precisely on a larger screen.

### Realtime / reconnection

Every screen with a live subscription (auction console, `/live`, quiz
runner, simulation console, analytics request queue) shows a visible
banner when the connection drops or is reconnecting, and always falls back
to a periodic poll — no screen silently shows stale data forever. See
`src/components/bidwave/reconnect-banner.tsx` and
`src/lib/realtime/use-live-broadcast.ts`.
