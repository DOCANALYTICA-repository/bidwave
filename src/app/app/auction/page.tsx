import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  StatTile,
  Money,
  MoneyDelta,
  EmptyState,
  StatusPill,
  MeterBar,
} from "@/components/bidwave";
import { TeamAuctionRealtime } from "@/app/app/auction/team-auction-realtime";
import { selectCurrentEdition } from "@/lib/event-edition";
import { getSettingsForEdition } from "@/lib/supabase/settings";

export const metadata: Metadata = { title: "Auction" };
export const dynamic = "force-dynamic";

/** Squad order a cricket team is actually read in, not alphabetical. */
const ROLE_ORDER = ["WICKET KEEPER", "BATTER", "ALL ROUNDER", "BOWLER"];

function roleRank(role: string) {
  const i = ROLE_ORDER.indexOf(role.toUpperCase());
  return i === -1 ? ROLE_ORDER.length : i;
}

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

  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return <div className="p-10 text-ink-2">No active event edition.</div>;

  const [{ data: roster }, { data: ledger }, { data: ruleSet }, { data: balanceRow }, settings] =
    await Promise.all([
      supabase
        .from("players_public")
        .select("id, full_name, role, pool, nationality, is_overseas, sale_price, sold_at")
        .eq("current_team_id", user.id)
        .eq("status", "sold")
        .order("sold_at", { ascending: false }),
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
      getSettingsForEdition(edition.id, ["auction_franchise_assignments"]),
    ]);

  const players = roster ?? [];
  const franchise = settings.auction_franchise_assignments?.[user.id] ?? null;

  const roleCounts: Record<string, number> = {};
  const poolCounts: Record<string, number> = {};
  let overseasCount = 0;
  let spend = 0;
  for (const p of players) {
    roleCounts[p.role] = (roleCounts[p.role] ?? 0) + 1;
    poolCounts[p.pool] = (poolCounts[p.pool] ?? 0) + 1;
    if (p.is_overseas) overseasCount++;
    spend += Number(p.sale_price ?? 0);
  }

  const overseasOk = !ruleSet || overseasCount <= ruleSet.max_overseas;
  const squadOk =
    !ruleSet || (players.length >= ruleSet.min_squad_size && players.length <= ruleSet.max_squad_size);

  // Grouped by role for reading the squad as a squad; each group keeps the
  // most-recent-first order within it.
  const byRole = new Map<string, typeof players>();
  for (const p of players) {
    if (!byRole.has(p.role)) byRole.set(p.role, []);
    byRole.get(p.role)!.push(p);
  }
  const roleGroups = Array.from(byRole.entries()).sort((a, b) => roleRank(a[0]) - roleRank(b[0]));

  const roleLimits = (ruleSet?.role_limits ?? {}) as Record<string, { max?: number } | undefined>;
  const mostExpensive = players.reduce<(typeof players)[number] | null>(
    (best, p) => (Number(p.sale_price ?? 0) > Number(best?.sale_price ?? 0) ? p : best),
    null,
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-12">
      <TeamAuctionRealtime eventEditionId={edition.id} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-heading text-xs font-semibold uppercase tracking-wide text-gold">
            The Grand Auction
          </p>
          <h1 className="font-display text-3xl">Your squad</h1>
          {/* Franchise identity is a text label only — PRD §24.2 forbids
              reproducing IPL logos, flags or official colours. */}
          {franchise && (
            <p className="mt-1 font-heading text-sm uppercase tracking-wide text-ink-2">
              Playing as {franchise}
            </p>
          )}
        </div>
        {/* Audit high-priority #8: no link to /app/auction/analytics
            existed anywhere in the team workflow. */}
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {[
            ["/app/auction/players", "Player list"],
            ["/app/auction/sales", "Sale log"],
            ["/app/auction/analytics", "Analytics"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-gold/40 hover:text-gold"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Purse remaining" value={<Money value={balanceRow?.balance ?? 0} />} tone="gold" />
        <StatTile label="Spent" value={<Money value={spend} />} />
        <StatTile
          label={ruleSet ? `Squad (min ${ruleSet.min_squad_size})` : "Squad size"}
          value={players.length}
          tone={squadOk ? "default" : "danger"}
        />
        <StatTile
          label={ruleSet ? `Overseas (max ${ruleSet.max_overseas})` : "Overseas"}
          value={overseasCount}
          tone={overseasOk ? "default" : "danger"}
        />
      </div>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between border-b border-border pb-2">
          <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
            Squad
          </h2>
          {mostExpensive && (
            <span className="text-xs text-ink-3">
              Marquee buy: {mostExpensive.full_name} · <Money value={Number(mostExpensive.sale_price ?? 0)} className="text-xs" />
            </span>
          )}
        </div>

        {players.length === 0 ? (
          <EmptyState
            title="No players yet"
            description="Your squad will appear here, grouped by role, as sales are recorded."
          />
        ) : (
          <div className="space-y-6">
            {roleGroups.map(([role, group]) => {
              const max = roleLimits[role]?.max;
              return (
                <div key={role} className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <p className="font-heading text-xs font-semibold uppercase tracking-wide text-ink-2">
                      {role}
                    </p>
                    <span className="font-mono text-xs text-ink-3">
                      {group.length}
                      {max ? ` / ${max}` : ""}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {group.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{p.full_name}</span>
                          <span className="block truncate text-xs text-ink-3">
                            {p.nationality} · {p.pool}
                            {p.is_overseas ? " · Overseas" : ""}
                          </span>
                        </span>
                        <Money value={Number(p.sale_price ?? 0)} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {ruleSet && (
        <section className="space-y-3">
          <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
            Compliance
          </h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <StatusPill
              status={squadOk ? "qualified" : "eliminated"}
              label={`Squad size ${squadOk ? "OK" : "Out of range"}`}
            />
            <StatusPill
              status={overseasOk ? "qualified" : "eliminated"}
              label={`Overseas ${overseasOk ? "OK" : "Over limit"}`}
            />
          </div>

          {Object.keys(roleLimits).length > 0 && (
            <div className="space-y-2 pt-1">
              {Object.entries(roleLimits).map(([role, limit]) => (
                <MeterBar
                  key={role}
                  label={role}
                  value={roleCounts[role] ?? 0}
                  max={limit?.max ?? 0}
                  tone={
                    limit?.max && (roleCounts[role] ?? 0) > limit.max ? "danger" : "analytics"
                  }
                />
              ))}
            </div>
          )}

          <p className="text-xs text-ink-3">
            Pools: {Object.entries(poolCounts).map(([p, c]) => `${p} ${c}`).join(", ") || "—"}
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
