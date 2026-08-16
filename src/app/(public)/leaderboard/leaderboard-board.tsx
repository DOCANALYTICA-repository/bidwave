export type Entry = { rank: number; team_name: string; score: number };

/**
 * Broadcast mood (see CLAUDE.md): this is the public reveal surface, so it
 * carries the motion the console surfaces deliberately don't.
 *
 * Three effects:
 *   - bottom-up stagger: the lowest rank animates in first and #1 lands last,
 *     so the eye is dragged up the board the way a results reveal reads.
 *   - ghost numerals: the rank repeated as an oversized, near-transparent
 *     display numeral behind the row.
 *   - podium colour: rank 1/2/3 get gold/silver/bronze on the numeral, the
 *     left edge and the score; everything below is neutral. One glance
 *     separates the podium from the pack without reading a single digit.
 *
 * Stays a server component — the stagger is a CSS keyframe (`.lb-row` in
 * globals.css), not `motion`. A JS enter-animation would ship `opacity: 0` in
 * the SSR HTML, which makes the standings permanently invisible to anyone
 * whose hydration fails, and freezes mid-reveal in a backgrounded tab
 * (reproduced directly). Reduced motion is honoured by the media query there.
 */

const PODIUM = [
  { colour: "var(--podium-1)", glow: "color-mix(in oklab, var(--podium-1) 14%, transparent)" },
  { colour: "var(--podium-2)", glow: "color-mix(in oklab, var(--podium-2) 12%, transparent)" },
  { colour: "var(--podium-3)", glow: "color-mix(in oklab, var(--podium-3) 12%, transparent)" },
];

export function LeaderboardBoard({
  title,
  coversLabel,
  publishedLabel,
  entries,
}: {
  title: string;
  coversLabel: string | null;
  /** Pre-formatted upstream — see page.tsx on why it isn't formatted here. */
  publishedLabel: string;
  entries: Entry[];
}) {
  if (entries.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-gold">
          {title}
        </h2>
        <p className="text-xs text-ink-3">
          {coversLabel && <span className="text-ink-2">{coversLabel} · </span>}
          Published {publishedLabel}
        </p>
      </div>

      <ol className="space-y-2">
        {entries.map((e, i) => {
          const podium = e.rank <= 3 ? PODIUM[e.rank - 1] : null;
          return (
            <li
              key={e.rank}
              className="lb-row relative flex items-center justify-between overflow-hidden rounded-lg border px-4 py-3"
              style={
                {
                  // Distance from the bottom row, so the reveal runs upward.
                  "--lb-i": entries.length - 1 - i,
                  borderColor: podium
                    ? `color-mix(in oklab, ${podium.colour} 45%, transparent)`
                    : "var(--border)",
                  background: podium
                    ? `linear-gradient(90deg, ${podium.glow}, transparent 60%), var(--card)`
                    : "var(--card)",
                  boxShadow: podium ? `inset 3px 0 0 0 ${podium.colour}` : undefined,
                } as React.CSSProperties
              }
            >
              {/* Ghost numeral. aria-hidden — the real rank is announced by the
                  visible one beside the team name. Parked to the left of the
                  score column rather than under it: at this size even 16%
                  opacity behind small tabular digits costs real legibility. */}
              <span
                aria-hidden
                className="pointer-events-none absolute right-16 top-1/2 -translate-y-1/2 select-none font-display text-[4.5rem] leading-none tabular-nums"
                style={{
                  color: podium?.colour ?? "var(--ink-3)",
                  opacity: podium ? 0.16 : 0.08,
                }}
              >
                {e.rank}
              </span>

              <span className="relative flex items-center gap-3">
                <span
                  className="w-6 font-mono text-sm font-bold tabular-nums"
                  style={{ color: podium?.colour ?? "var(--ink-3)" }}
                >
                  {e.rank}
                </span>
                <span className="font-medium">{e.team_name}</span>
              </span>

              <span
                className="relative font-mono tabular-nums"
                style={{ color: podium?.colour ?? "var(--gold)" }}
              >
                {e.score}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
