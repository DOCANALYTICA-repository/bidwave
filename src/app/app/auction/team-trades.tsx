import { EmptyState } from "@/components/bidwave";
import { formatCrore, formatRupees } from "@/lib/auction/format";

/**
 * Trades this team was part of, told from their side of the deal.
 *
 * The cash half of a trade already reaches a team through the purse ledger
 * ('trade' entry_kind, with both franchise names in the memo). The players half
 * did not: a squad member simply vanished and a stranger appeared, with nothing
 * on the page to explain either. This is that explanation.
 *
 * Deliberately "In"/"Out" rather than the stored A/B orientation — which side
 * of `auction_trades` a team happens to sit on is a storage detail, and no team
 * thinks of their own squad in those terms.
 */
export type TeamTrade = {
  id: string;
  /** The other franchise, aliased. */
  counterparty: string;
  executedAt: string;
  reversedAt: string | null;
  memo: string | null;
  /** Signed from this team's perspective: negative is cash out. */
  netCash: number;
  playersIn: { id: string; name: string; price: number | null }[];
  playersOut: { id: string; name: string; price: number | null }[];
};

export function TeamTrades({ trades }: { trades: TeamTrade[] }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
        Trades
      </h2>
      {trades.length === 0 ? (
        <EmptyState
          title="No trades"
          description="Any swap of players or cash with another franchise appears here."
        />
      ) : (
        <ul className="space-y-2">
          {trades.map((trade) => (
            <li
              key={trade.id}
              className={`space-y-1.5 rounded-lg border border-border px-3 py-2 ${
                trade.reversedAt ? "bg-surface-2 opacity-70" : "bg-card"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  With <span className="text-gold">{trade.counterparty}</span>
                  {trade.reversedAt && (
                    <span className="ml-2 text-xs font-normal text-unsold">
                      reversed
                    </span>
                  )}
                </p>
                <p className="font-mono text-xs tabular-nums text-ink-3">
                  {new Date(trade.executedAt).toLocaleDateString()}
                </p>
              </div>

              <TradeLine label="In" players={trade.playersIn} />
              <TradeLine label="Out" players={trade.playersOut} />

              {trade.netCash !== 0 && (
                <p
                  className="text-xs text-ink-2"
                  title={formatRupees(Math.abs(trade.netCash))}
                >
                  Cash {trade.netCash > 0 ? "received" : "paid"}{" "}
                  <span className="font-mono tabular-nums">
                    {formatCrore(Math.abs(trade.netCash))}
                  </span>
                </p>
              )}
              {trade.memo && (
                <p className="text-xs text-ink-3">“{trade.memo}”</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TradeLine({
  label,
  players,
}: {
  label: string;
  players: TeamTrade["playersIn"];
}) {
  if (players.length === 0) return null;
  return (
    <p className="text-xs text-ink-2">
      <span className="font-semibold uppercase tracking-wide text-ink-3">
        {label}
      </span>{" "}
      {players.map((p, i) => (
        <span key={p.id}>
          {i > 0 && ", "}
          {p.name}
          {p.price != null && (
            <span className="ml-0.5 font-mono tabular-nums text-ink-3">
              ({formatCrore(p.price)})
            </span>
          )}
        </span>
      ))}
    </p>
  );
}
