import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatTile, Money, MoneyDelta, EmptyState, StatusPill } from "@/components/bidwave";
import { TeamAuctionRealtime } from "@/app/app/auction/team-auction-realtime";

export const metadata: Metadata = { title: "Auction" };
export const dynamic = "force-dynamic";

/**
 * TEAM-AUC-01..06: own roster, purse, composition/compliance, live update.
 * TEAM-AUC-05/§29 — no bid entry, raise-bid or auction-control interface of
 * any kind: this file never imports record_sale/set_active_player/any
 * mutating action, so there is no endpoint here to gate against misuse.
 */
export default async function TeamAuctionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: edition } = await supabase
    .from("event_editions")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();
  if (!edition) return <div className="p-10 text-ink-2">No active event edition.</div>;

  const [{ data: roster }, { data: ledger }, { data: ruleSet }, { data: balanceRow }] = await Promise.all([
    supabase
      .from("players_public")
      .select("id, full_name, role, pool, is_overseas, sale_price")
      .eq("current_team_id", user.id)
      .eq("status", "sold")
      .order("full_name"),
    supabase
      .from("purse_ledger")
      .select("id, entry_kind, amount, memo, created_at")
      .eq("team_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("auction_rule_sets")
      .select("*")
      .eq("event_edition_id", edition.id)
      .eq("is_active", true)
      .maybeSingle(),
    supabase.from("team_purse_balances").select("balance").eq("team_id", user.id).maybeSingle(),
  ]);

  const players = roster ?? [];
  const roleCounts: Record<string, number> = {};
  const poolCounts: Record<string, number> = {};
  let overseasCount = 0;
  for (const p of players) {
    roleCounts[p.role] = (roleCounts[p.role] ?? 0) + 1;
    poolCounts[p.pool] = (poolCounts[p.pool] ?? 0) + 1;
    if (p.is_overseas) overseasCount++;
  }

  const overseasOk = !ruleSet || overseasCount <= ruleSet.max_overseas;
  const squadOk =
    !ruleSet || (players.length >= ruleSet.min_squad_size && players.length <= ruleSet.max_squad_size);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-12">
      <TeamAuctionRealtime eventEditionId={edition.id} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-heading text-xs font-semibold uppercase tracking-wide text-gold">
            The Grand Auction
          </p>
          <h1 className="font-display text-3xl">Your squad</h1>
        </div>
        {/* Audit high-priority #8: no link to /app/auction/analytics
            existed anywhere in the team workflow. */}
        <Link
          href="/app/auction/analytics"
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-gold/40 hover:text-gold"
        >
          Analytics
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Purse remaining" value={<Money value={balanceRow?.balance ?? 0} />} tone="gold" />
        <StatTile label="Squad size" value={players.length} tone={squadOk ? "default" : "danger"} />
        <StatTile label="Overseas" value={overseasCount} tone={overseasOk ? "default" : "danger"} />
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">Roster</h2>
        {players.length === 0 ? (
          <EmptyState title="No players yet" description="Your squad will appear here as sales are recorded." />
        ) : (
          <ul className="space-y-2">
            {players.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2"
              >
                <span>
                  <span className="font-medium">{p.full_name}</span>
                  <span className="ml-2 text-xs text-ink-3">
                    {p.role} · {p.pool}
                    {p.is_overseas ? " · Overseas" : ""}
                  </span>
                </span>
                <Money value={p.sale_price ?? 0} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {ruleSet && (
        <section className="space-y-2">
          <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">Compliance</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <StatusPill status={squadOk ? "qualified" : "eliminated"} label={`Squad size ${squadOk ? "OK" : "Out of range"}`} />
            <StatusPill status={overseasOk ? "qualified" : "eliminated"} label={`Overseas ${overseasOk ? "OK" : "Over limit"}`} />
          </div>
          <p className="text-xs text-ink-3">
            Roles: {Object.entries(roleCounts).map(([r, c]) => `${r} ${c}`).join(", ") || "—"} · Pools:{" "}
            {Object.entries(poolCounts).map(([p, c]) => `${p} ${c}`).join(", ") || "—"}
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          Purse transactions
        </h2>
        {!ledger || ledger.length === 0 ? (
          <EmptyState title="No transactions yet" />
        ) : (
          <ul className="space-y-1.5">
            {ledger.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between text-sm">
                <span className="text-ink-2">
                  {entry.entry_kind}
                  {entry.memo ? ` — ${entry.memo}` : ""}
                </span>
                <MoneyDelta value={entry.amount} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
