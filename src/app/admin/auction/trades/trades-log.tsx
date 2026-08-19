"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reverseTrade } from "@/app/admin/auction/trades/actions";
import { formatCrore, formatRupees } from "@/lib/auction/format";

export type TradeLogRow = {
  id: string;
  teamA: string;
  teamB: string;
  cashAToB: number;
  cashBToA: number;
  memo: string | null;
  executedAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
  legs: {
    playerId: string;
    playerName: string;
    fromTeam: string;
    toTeam: string;
    priceAtTrade: number | null;
  }[];
};

export function TradesLog({ trades }: { trades: TradeLogRow[] }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
        Trade log
      </h2>
      {trades.length === 0 ? (
        <EmptyState
          title="No trades yet"
          description="Executed trades appear here, each reversible until one of its players moves again."
        />
      ) : (
        <ul className="space-y-3">
          {trades.map((trade) => (
            <TradeCard key={trade.id} trade={trade} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TradeCard({ trade }: { trade: TradeLogRow }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [isReversing, setIsReversing] = useState(false);
  const [showReverse, setShowReverse] = useState(false);
  const reversed = trade.reversedAt != null;

  // Grouped by direction so the card reads like the deal was struck, rather
  // than as a flat list of legs the reader has to sort out themselves.
  const aToB = trade.legs.filter((l) => l.fromTeam === trade.teamA);
  const bToA = trade.legs.filter((l) => l.fromTeam === trade.teamB);

  return (
    <li
      className={`space-y-3 rounded-xl border p-4 ${
        reversed ? "border-border bg-surface-2 opacity-70" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {trade.teamA} <span className="text-ink-3">↔</span> {trade.teamB}
        </p>
        <p className="font-mono text-xs tabular-nums text-ink-3">
          {new Date(trade.executedAt).toLocaleString()}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TradeDirection
          from={trade.teamA}
          to={trade.teamB}
          legs={aToB}
          cash={trade.cashAToB}
        />
        <TradeDirection
          from={trade.teamB}
          to={trade.teamA}
          legs={bToA}
          cash={trade.cashBToA}
        />
      </div>

      {trade.memo && <p className="text-xs text-ink-2">“{trade.memo}”</p>}

      {reversed ? (
        <p className="text-xs text-unsold">
          Reversed{trade.reversalReason ? ` — ${trade.reversalReason}` : ""}
        </p>
      ) : showReverse ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`reverse-${trade.id}`}>Reason</Label>
            <Input
              id={`reverse-${trade.id}`}
              className="w-72"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this trade is being undone"
            />
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={isReversing || reason.trim() === ""}
            onClick={async () => {
              setIsReversing(true);
              const result = await reverseTrade(trade.id, reason.trim());
              setIsReversing(false);
              if (result.error) {
                toast.error(result.error);
              } else {
                toast.success("Trade reversed.");
                setShowReverse(false);
                setReason("");
              }
              router.refresh();
            }}
          >
            {isReversing ? "Reversing…" : "Confirm reversal"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowReverse(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowReverse(true)}>
          Reverse…
        </Button>
      )}
    </li>
  );
}

function TradeDirection({
  from,
  to,
  legs,
  cash,
}: {
  from: string;
  to: string;
  legs: TradeLogRow["legs"];
  cash: number;
}) {
  if (legs.length === 0 && cash === 0) {
    return (
      <div className="rounded-lg border border-border px-3 py-2 text-xs text-ink-3">
        {from} sent nothing
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-lg border border-border px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        {from} → {to}
      </p>
      {legs.map((leg) => (
        <p key={leg.playerId} className="flex items-baseline justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">{leg.playerName}</span>
          {leg.priceAtTrade != null && (
            <span
              title={`Auction price ${formatRupees(leg.priceAtTrade)}`}
              className="shrink-0 font-mono text-xs tabular-nums text-ink-3"
            >
              {formatCrore(leg.priceAtTrade)}
            </span>
          )}
        </p>
      ))}
      {cash > 0 && (
        <p className="text-sm font-medium text-gold" title={formatRupees(cash)}>
          {formatCrore(cash)} cash
        </p>
      )}
    </div>
  );
}
