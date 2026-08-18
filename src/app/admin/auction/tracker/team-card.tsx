import type { ReactNode } from "react";
import { Money } from "@/components/bidwave";
import type { SquadPlayer, TeamTracker } from "@/lib/auction/analytics";

/**
 * One team's line on the live tracker: who they are, what the purse looks
 * like, and every player they own with what it cost. Purely presentational —
 * every number arrives already computed by buildTeamTrackers (principle #1),
 * so this file does no purse arithmetic beyond turning a ratio into a bar
 * width.
 */
export function TeamCard({
  team,
  minSquadSize,
}: {
  team: TeamTracker;
  minSquadSize: number;
}) {
  const spentPct =
    team.purse.funded > 0 ? (team.purse.playerSpend / team.purse.funded) * 100 : 0;
  const shortOfMinimum = team.slotsToMinimum > 0;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-xs text-ink-2">
            {team.rank ?? "—"}
          </span>
          <div>
            <h2 className="font-heading text-base font-semibold">{team.franchise ?? team.name}</h2>
            {team.franchise && <p className="text-xs text-ink-3">{team.name}</p>}
            <p className="mt-1 text-xs text-ink-2">
              Squad{" "}
              <span className={shortOfMinimum ? "text-unsold" : "text-sold"}>{team.squadSize}</span>
              {minSquadSize > 0 && <> / {minSquadSize} min</>} · {team.slotsToMaximum} slot
              {team.slotsToMaximum === 1 ? "" : "s"} free · Overseas {team.overseasCount} (
              {team.overseasRemaining} left)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-6 text-right">
          <Figure label="Purse left" tone="gold">
            <Money value={team.purse.balance} className="text-lg" />
          </Figure>
          <Figure label="Spent">
            <Money value={team.purse.playerSpend} className="text-lg" />
          </Figure>
          <Figure label="Max bid now" hint="Reserving the minimum squad">
            <Money value={team.maxBidNow} className="text-lg" />
          </Figure>
        </div>
      </header>

      <div className="px-5 pt-3">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
          role="img"
          aria-label={`${Math.round(spentPct)}% of purse spent`}
        >
          <div
            className="h-full rounded-full bg-analytics"
            style={{ width: `${Math.min(100, spentPct)}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-ink-3">
          {Math.round(spentPct)}% of <Money value={team.purse.funded} className="text-xs" /> funded
          spent
          {team.averagePrice != null && (
            <>
              {" "}
              · avg <Money value={team.averagePrice} className="text-xs" /> per player
            </>
          )}
          {team.purse.analyticsSpend > 0 && (
            <>
              {" "}
              · <Money value={team.purse.analyticsSpend} className="text-xs" /> on analytics
            </>
          )}
        </p>
      </div>

      <div className="px-5 py-4">
        {team.squad.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-ink-3">
            No players bought yet.
          </p>
        ) : (
          <SquadTable squad={team.squad} />
        )}
      </div>
    </section>
  );
}

function Figure({
  label,
  hint,
  tone = "default",
  children,
}: {
  label: string;
  hint?: string;
  tone?: "default" | "gold";
  children: ReactNode;
}) {
  return (
    <div>
      <div className="font-heading text-[0.65rem] font-semibold uppercase tracking-wide text-ink-2">
        {label}
      </div>
      <div className={tone === "gold" ? "text-gold" : undefined}>{children}</div>
      {hint && <div className="text-[0.65rem] text-ink-3">{hint}</div>}
    </div>
  );
}

/**
 * Plain table rather than the shared DataTable: this one nests inside a card
 * that already owns the border and heading, so DataTable's own border and
 * empty-state chrome would double up.
 */
function SquadTable({ squad }: { squad: SquadPlayer[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left font-heading text-xs uppercase tracking-wide text-ink-2">
            <th className="pb-2 font-semibold">Player</th>
            <th className="pb-2 font-semibold">Role</th>
            <th className="pb-2 font-semibold">Pool</th>
            <th className="pb-2 text-right font-semibold">Base</th>
            <th className="pb-2 text-right font-semibold">Paid</th>
            <th className="pb-2 text-right font-semibold">vs base</th>
          </tr>
        </thead>
        <tbody>
          {squad.map((p) => (
            <tr key={p.id} className="border-b border-border/50 last:border-0">
              <td className="py-1.5">
                {p.name}
                {p.isOverseas && (
                  <span className="ml-1.5 rounded bg-surface-3 px-1 py-0.5 text-[0.6rem] uppercase text-ink-3">
                    Overseas
                  </span>
                )}
              </td>
              <td className="py-1.5 text-xs text-ink-2">{p.role}</td>
              <td className="py-1.5 text-xs text-ink-3">{p.pool}</td>
              <td className="py-1.5 text-right">
                <Money value={p.basePrice} className="text-xs text-ink-2" />
              </td>
              <td className="py-1.5 text-right">
                <Money value={p.salePrice} className="text-xs" />
              </td>
              <td className="py-1.5 text-right">
                {p.realisation == null ? (
                  <span className="text-xs text-ink-3">—</span>
                ) : (
                  <span
                    className={
                      p.realisation > 1
                        ? "font-mono text-xs text-gold"
                        : "font-mono text-xs text-ink-3"
                    }
                  >
                    {p.realisation.toFixed(2)}×
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
