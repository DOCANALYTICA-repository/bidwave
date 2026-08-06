# Bidwave Design System

Live reference: `/dev/kitchen-sink` (not part of the shipped product — every
token and component rendered in one page). This document explains the *why*
behind what's there; read it alongside the page, not instead of it.

## Why dark-only

Bidwave is a sports-broadcast auction console, not a SaaS dashboard with a
light/dark preference toggle. The brochure, the BidWave logo, and the whole
"broadcast companion" brief in PRD §15.1 are all dark-native. Building a
light theme nobody asked for would double the design surface for zero
requirement — so `.dark` is applied unconditionally to `<html>` in
`layout.tsx`, and the same token values are duplicated into `:root` purely
as a flash-of-unstyled-content guard before that class attaches. There is no
theme switcher and none should be added without a PRD change.

## Where the palette came from

Sampled directly from `Logos/5.png` (`reference/Logos/5.png`) — the gold is
the logo's own gold, not a designer's guess at "IPL gold". The full ramp:

| Token | Hex | Use |
|---|---|---|
| `--gold-bright` | `#F5D77A` | hover/active states, highlights |
| `--gold` | `#EEC34B` | primary actions, focus rings, brand accents |
| `--gold-deep` | `#C9A03A` | pressed states, chart accent |
| `--surface-0` … `--surface-4` | `#000000` → `#1F1F23` | page background → most-elevated chrome |
| `--foreground` | `#FFFFFF` | primary text |
| `--ink-2` / `--ink-3` | `#A8A8AE` / `#6E6E76` | secondary / tertiary text |
| `--sold` | `#3FBF7F` | successful sale, qualified, purchased-adjacent success |
| `--unsold` | `#E5484D` | blocked sale, eliminated, destructive actions |
| `--live` | `#F5A524` | actively-running state (active player, live round) |
| `--analytics` | `#00AFF0` | DOC Analytica's own blue — reused everywhere the analytics module renders, so its data-viz language is visibly theirs |
| `--turf` | `#2E7D32` | sparing pitch/turf accent |

All of these are exposed as Tailwind utilities via the `@theme inline` block
in `globals.css` (`bg-gold`, `text-ink-2`, `bg-surface-2`, `text-sold`, …) —
never reach for a raw hex in a component.

## Two visual moods, one system

- **Broadcast** — the public landing page, `/live`, the admin auction
  console. High contrast, gold accents, motion communicates state changes
  (a sale landing, a leaderboard shift). This is where `Money`'s
  `animateChange` and the `sold`/`live` status pulses belong.
- **Console** — team submission flows, quiz runner, most of the admin
  dashboard. Calm, dense, minimal motion — §24.2 explicitly asks for these
  surfaces to be more utilitarian than the live-auction views. Don't
  borrow broadcast-mood animation for a scoring-entry form.

Both moods share every token and component below; the difference is in
which components a screen reaches for and how much motion it asks them to
do, not a separate stylesheet.

## Typography

| Role | Font | Notes |
|---|---|---|
| Display | **Anton** | Stand-in for the brochure's commercial *Zuume Rough Bold*. Swapping in a licensed font later means changing one `next/font/google` import in `layout.tsx` — every `font-display` usage picks it up automatically. |
| Heading | **League Spartan** | Section headings, labels, scoreboard/ticker text. |
| Serif | **Arapey** | Editorial long-form copy — round narratives, the about section — matching the brochure's own body serif. |
| Sans | **Inter** | All UI chrome and body text. |
| Mono | **JetBrains Mono** | Tabular numerals only: purse, scores, timers, timestamps. Always paired with `tabular-nums` so digit columns don't jitter. |

## Brand marks

`public/brand/` holds four pre-processed, transparent PNGs — never
reference `reference/Logos/*.png` from application code (those are flattened
opaque originals, gitignored, kept only for provenance).

The originals came as opaque squares (mark flattened onto a solid black or
white background, no alpha channel — verified with PIL, not assumed). Since
the whole product is dark-only, only the on-black variants were usable
sources; they were recovered to transparent PNGs by **unpremultiplying
against black**: for an anti-aliased mark of color *C* flattened onto pure
black, the observed pixel is `C × alpha` (black contributes nothing), so
`alpha = max(r,g,b)` and the true color falls out by dividing back through.
Each was then cropped to its content bounding box plus ~4% padding, so the
`BrandMark` component's declared aspect ratios describe the visible mark,
not an arbitrary canvas.

Use `<BrandMark name="..." height={n} />` — never `next/image` directly —
so every placement stays in sync with the correct aspect ratio. Available
names: `bidwave`, `christ-university`, `doc-commerce`, `doc-analytica`.

**DOC Analytica placement** (per the explicit brief that their mark needs
prominent, non-overlapping placement): the paid analytics module's header
(`doc-analytica` at `height={64}`, its natural home), a "Built by DOC
Analytica" credit in the global footer, and the admin sign-in screen /
console sidebar footer.

## Component kit (`src/components/bidwave/`)

Composed, Bidwave-specific components built on the shadcn primitives in
`src/components/ui/`. Reach for these before reaching for a raw primitive
or a one-off `<div>`:

- **`StatusPill`** — the *only* place status vocabulary is defined. Encodes
  the exact §8.1 classroom status language (Upcoming / Open — eligible /
  Open — view only / Submitted / Closed / Scored) plus auction (§21.3) and
  analytics (§21.4) states, each mapped to one tone. Adding a new status
  anywhere in the product means adding one entry to `STATUS_TONES`, not
  inventing a new badge.
- **`StatTile`** — labeled numeric/text tile for dashboards and broadcast
  panels (rank, purse, squad size).
- **`Money` / `MoneyDelta`** — Indian digit grouping (`Intl.NumberFormat("en-IN")`)
  in tabular numerals. `Money` never computes an amount — it only renders
  whatever the server already decided (architecture principle #1). The
  `animateChange` prop is for broadcast-mood live updates only.
- **`Countdown`** — ticks toward a deadline, but is anchored to a
  server-issued timestamp (`serverNowAtMount`), never the browser's own
  clock (SEC-06, QZ-16, SIM-08). The display is cosmetic; every real
  deadline check happens server-side regardless of what this shows.
- **`FileDrop`** — drag/drop + click picker for submissions (§9.1) and the
  registration invoice (REG-07). `maxSizeBytes` is a friendly heads-up, not
  enforcement — the actual ceiling is Supabase Storage's
  `file_size_limit` (see `supabase/config.toml`), surfaced honestly per
  ERR-02, not silently capped client-side.
- **`EmptyState`** — the standard empty/zero-data treatment (§24.4).
- **`ReconnectBanner`** — presentational only; a Realtime subscription or
  the quiz heartbeat owns the actual `ConnectionStatus` and decides when to
  refetch (ERR-08, NFR-05). `useBrowserConnectionStatus` is the fallback
  for callers with no Realtime channel of their own.
- **`DataTable`** — a thin wrapper around the shadcn `Table` primitive, not
  a TanStack Table integration. Most admin tables in this product
  (submissions, sales log, activity) are short enough not to need sorting/
  pagination/virtualization; a screen that genuinely needs that (the
  auction console's player list, the teams directory) should layer
  TanStack on top of this locally rather than the whole product taking on
  that dependency for every table.

## shadcn/ui is on Base UI, not Radix

Also documented in `CLAUDE.md` because it affects every future screen: this
scaffold's shadcn build composes triggers with a **`render` prop**, not
`asChild` — `<DialogTrigger render={<Button variant="outline" />}>Open</DialogTrigger>`.
`TooltipProvider` takes `delay`, not `delayDuration`. Check the actual
component source in `src/components/ui/` before assuming a Radix-era API.

## Motion (UX-01 through UX-06)

Use `motion/react` (the `motion` package's React entry point, not the
legacy `framer-motion` package name) for anything beyond a CSS
transition. Every animated component in the kit already calls
`useReducedMotion()` and substitutes a plain fade or nothing at all — do
the same in any new component; UX-05 is not optional. Motion should
communicate a state change (a sale landing, a status flip, a value
changing) — if a reviewer can't tell *why* something is animating, it's
decoration, not the "purposeful" motion UX-01 asks for.

## Reduced-motion baseline

`globals.css` includes a blanket `prefers-reduced-motion: reduce` override
that collapses all CSS transitions/animations to near-zero duration. This
is the safety net for third-party components and utility classes; it does
not replace calling `useReducedMotion()` inside a component that
choreographs a multi-step sequence (e.g. the simulation's result reveal in
Phase 5) — that needs to skip steps outright, not just speed through them.
