import { formatCrore } from "@/lib/auction/format";
import type { TeamTracker } from "@/lib/auction/analytics";

/**
 * The at-a-glance board: every franchise, its squad with what each player
 * cost, and its purse remaining — nothing else. Six across, two rows, sized
 * to one laptop screen so the whole auction is legible without scrolling.
 *
 * The grid is pinned to the viewport rather than left to grow, because the
 * promise here is "one screen" and squads run to 23 players by the end. Each
 * tile's player list scrolls inside its own box, so a full squad never pushes
 * the second row of franchises below the fold. Below this board the page
 * continues with the full detail view.
 *
 * The viewport pin is `lg:` only — on a phone or a narrow split view the
 * board falls back to a normal flowing grid, where a fixed height would just
 * produce twelve tiny scrollers.
 */
export function SquadBoard({ teams }: { teams: TeamTracker[] }) {
  return (
    // 9rem is the measured chrome above the grid — admin sidebar row, the
    // auction sub-nav (57px), this section's top padding and the header line
    // — leaving ~30px of slack at the bottom on every laptop height tried
    // (1280x800 through 1512x982). The height is vh-derived, so that slack is
    // constant rather than something that shrinks on a short screen.
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:h-[calc(100vh-9rem)] lg:grid-cols-6 lg:grid-rows-2">
      {teams.map((t) => (
        <BoardTile key={t.teamId} team={t} />
      ))}
    </div>
  );
}

function BoardTile({ team }: { team: TeamTracker }) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="shrink-0 border-b border-border px-2 py-1.5">
        <div className="flex items-baseline justify-between gap-1">
          <h3
            className="truncate font-heading text-[11px] font-semibold uppercase tracking-wide"
            title={`${team.franchise ?? team.name} — ${team.name}`}
          >
            {team.franchise ?? team.name}
          </h3>
          <span className="shrink-0 font-mono text-[10px] text-ink-3">{team.squadSize}</span>
        </div>
        <div className="font-mono text-[13px] font-bold tabular-nums text-gold">
          {formatCrore(team.purse.balance)}
        </div>
      </header>

      {team.squad.length === 0 ? (
        <div className="grid flex-1 place-items-center px-2 text-[10px] text-ink-3">
          No players yet
        </div>
      ) : (
        // min-h-0 is what actually lets this scroll: without it the flex item
        // takes its content height and the tile grows past the grid row.
        <ul className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 py-1">
          {team.squad.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-1.5 text-[10px]">
              <span className="truncate text-ink-2" title={p.name}>
                {p.name}
              </span>
              <span className="shrink-0 font-mono tabular-nums">{formatCrore(p.salePrice)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
