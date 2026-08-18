import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import {
  StatTile,
  Money,
  MeterBar,
  EmptyState,
  Sparkline,
  DataTable,
  type DataTableColumn,
} from "@/components/bidwave";
import { selectCurrentEdition } from "@/lib/event-edition";
import { getSettingsForEdition } from "@/lib/supabase/settings";
import { AdminAnalyticsRealtime } from "@/app/admin/auction/analytics/admin-analytics-realtime";
import {
  computeMarketPulse,
  computeTeamStandings,
  cumulativeSpend,
  groupProgress,
  saleTimeline,
  summariseRosters,
  teamsAtRisk,
  type GroupProgress,
  type PlayerRow,
  type TeamStanding,
} from "@/lib/auction/analytics";

export const metadata: Metadata = { title: "Auction — Analytics" };
export const dynamic = "force-dynamic";

/** Pinned locale — the same hydration-mismatch trap console-sales-log.tsx hit. */
const timeFmt = new Intl.DateTimeFormat("en-IN", {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function pct(n: number | null, digits = 0) {
  return n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

/**
 * The admin's own operational dashboard — distinct from the team-facing paid
 * module at /app/auction/analytics. Live via broadcast ping, and computed
 * entirely from lib/auction/analytics.ts so the console and this page cannot
 * disagree about what "squad size" or "realisation" means.
 *
 * Price realisation (sale ÷ base for sold lots) is the headline: it is the one
 * number that says whether the room is bidding hot or cold, and it was absent
 * from this page entirely before.
 */
export default async function AdminAuctionAnalyticsPage() {
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return <div className="p-10 text-ink-2">No active event edition.</div>;

  // Which teams are actually in the auction is not a franchise-assignment
  // question and not a hardcoded "top 12" — it is the same gate the sale
  // engine and admin_grant_starting_purses() use: qualified at the stage the
  // auction round points to via requires_qualification_from_stage (currently
  // Rounds 3 + 4). Deriving it here keeps this dashboard from disagreeing
  // with who can actually be sold a player.
  const { data: auctionRound } = await supabase
    .from("rounds")
    .select("id, requires_qualification_from_stage")
    .eq("event_edition_id", edition.id)
    .eq("kind", "auction")
    .maybeSingle();

  const gateStageId = auctionRound?.requires_qualification_from_stage ?? null;

  const [{ data: playerRows }, { data: purses }, { data: sales }, { data: auditEvents }, settings, { data: ruleSet }, { data: quals }] =
    await Promise.all([
      supabase
        .from("players")
        .select(
          "id, full_name, role, pool, status, is_overseas, base_price, sale_price, current_team_id, sold_at",
        )
        .eq("event_edition_id", edition.id),
      supabase.from("public_team_purses").select("*").eq("event_edition_id", edition.id),
      supabase
        .from("auction_sales")
        .select("id, player_id, team_id, amount, sold_at, reversed_at")
        .eq("event_edition_id", edition.id)
        .order("sold_at", { ascending: false }),
      supabase
        .from("auction_audit_events")
        .select("id, kind, created_at, detail")
        .eq("event_edition_id", edition.id)
        .order("created_at", { ascending: false })
        .limit(25),
      getSettingsForEdition(edition.id, ["auction_franchise_assignments"]),
      supabase
        .from("auction_rule_sets")
        .select("*")
        .eq("event_edition_id", edition.id)
        .eq("is_active", true)
        .maybeSingle(),
      gateStageId
        ? supabase
            .from("qualifications")
            .select("team_id, rank")
            .eq("stage_id", gateStageId)
            .eq("decision", "qualified")
        : Promise.resolve({ data: [] as { team_id: string; rank: number | null }[] }),
    ]);

  const players = (playerRows ?? []) as PlayerRow[];
  const franchises = settings.auction_franchise_assignments ?? {};
  const minSquadSize = ruleSet?.min_squad_size ?? 0;

  const pulse = computeMarketPulse(players);
  const rosters = summariseRosters(players);
  const byPool = groupProgress(players, (p) => p.pool);
  const byRole = groupProgress(players, (p) => p.role);

  // public_team_purses covers every registered team (97 of them), so it must
  // be narrowed to the qualified field before anything here means anything.
  const qualifiedRank = new Map(
    (quals ?? []).map((q) => [q.team_id as string, (q.rank as number | null) ?? null]),
  );
  const allTeams = (purses ?? []).map((t) => ({
    team_id: t.team_id as string,
    name: t.name as string,
    purse_balance: Number(t.purse_balance ?? 0),
  }));
  const gateResolved = qualifiedRank.size > 0;
  const biddingTeams = gateResolved
    ? allTeams.filter((t) => qualifiedRank.has(t.team_id))
    : allTeams;

  const standings = computeTeamStandings(biddingTeams, rosters, franchises, minSquadSize)
    // Qualifying rank is the order the room thinks in; fall back to spend
    // ordering only for teams the stage left unranked.
    .sort((a, b) => {
      const ra = qualifiedRank.get(a.teamId);
      const rb = qualifiedRank.get(b.teamId);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return b.spend - a.spend;
    });
  const atRisk = teamsAtRisk(standings, pulse.averagePrice);

  const timeline = saleTimeline(players);
  const cumulative = cumulativeSpend(players);
  const reversals = (sales ?? []).filter((s) => s.reversed_at).length;

  const statusCounts = players.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  const trend =
    pulse.earlyRealisation != null && pulse.lateRealisation != null
      ? pulse.lateRealisation - pulse.earlyRealisation
      : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 px-6 py-10">
      <AdminAnalyticsRealtime eventEditionId={edition.id} />

      <div className="space-y-1">
        <h1 className="font-display text-2xl">Auction — Analytics</h1>
        <p className="text-sm text-ink-2">
          Live view of the room. {players.length} lots catalogued ·{" "}
          {gateResolved
            ? `${biddingTeams.length} qualified teams bidding`
            : "qualification stage not decided — showing all teams"}
          .
        </p>
      </div>

      {players.length === 0 ? (
        <EmptyState
          title="No players imported"
          description="Import the auction pool to populate this dashboard."
        />
      ) : (
        <>
          {/* ---------------- headline ---------------- */}
          <section className="space-y-4">
            <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
              Market pulse
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Price realisation"
                value={pct(pulse.realisation)}
                tone="gold"
                hint="Total paid ÷ total base price of sold lots"
              />
              <StatTile label="Total spend" value={<Money value={pulse.totalSpend} />} />
              <StatTile
                label="Average price"
                value={pulse.averagePrice != null ? <Money value={pulse.averagePrice} /> : "—"}
              />
              <StatTile
                label="Median price"
                value={pulse.medianPrice != null ? <Money value={pulse.medianPrice} /> : "—"}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Sold" value={pulse.lotsSold} tone="success" />
              <StatTile label="Unsold" value={pulse.lotsUnsold} tone="danger" />
              <StatTile label="Still to come" value={pulse.lotsRemaining} />
              <StatTile
                label="Reversals"
                value={reversals}
                tone={reversals > 0 ? "danger" : "default"}
              />
            </div>

            {(pulse.highestSale || trend != null) && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-2">
                {pulse.highestSale && (
                  <span>
                    Biggest buy: <span className="text-foreground">{pulse.highestSale.name}</span> at{" "}
                    <Money value={pulse.highestSale.amount} className="text-xs" />
                  </span>
                )}
                {trend != null && (
                  <span>
                    Realisation {trend >= 0 ? "up" : "down"} {pct(Math.abs(trend))} from the opening
                    third to the closing third ({pct(pulse.earlyRealisation)} → {pct(pulse.lateRealisation)})
                  </span>
                )}
              </div>
            )}
          </section>

          {/* ---------------- timelines ---------------- */}
          {timeline.values.length > 1 && (
            <section className="grid gap-8 lg:grid-cols-2">
              <div className="space-y-2">
                <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
                  Sale price, in order sold
                </h2>
                <Sparkline
                  values={timeline.values}
                  labels={timeline.labels}
                  format="crore"
                  ariaLabel={`Sale price for each of ${timeline.values.length} lots, in the order they sold`}
                  height={80}
                />
                <p className="text-xs text-ink-3">Hover a point for the player and price.</p>
              </div>
              <div className="space-y-2">
                <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
                  Cumulative spend
                </h2>
                <Sparkline
                  values={cumulative}
                  labels={timeline.labels}
                  tone="analytics"
                  format="crore"
                  ariaLabel="Cumulative money committed across the auction"
                  height={80}
                />
                <p className="text-xs text-ink-3">
                  Total committed so far: <Money value={pulse.totalSpend} className="text-xs" />
                </p>
              </div>
            </section>
          )}

          {/* ---------------- teams ---------------- */}
          <section className="space-y-4">
            <div className="flex items-baseline justify-between border-b border-border pb-2">
              <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
                Franchise standings
              </h2>
              <span className="font-mono text-xs text-ink-3">{standings.length} teams</span>
            </div>

            {!gateResolved && (
              <div className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-ink-2">
                No team has been marked qualified at the auction&rsquo;s gating stage yet, so every
                registered team is listed. Record Rounds 3 + 4 decisions in Stages to narrow this to
                the bidding field.
              </div>
            )}

            {atRisk.length > 0 && (
              <div className="rounded-lg border border-unsold/40 bg-unsold/5 px-4 py-3 text-xs">
                <span className="font-medium text-unsold">Short of purse:</span>{" "}
                <span className="text-ink-2">
                  {atRisk.map((t) => t.franchise ?? t.name).join(", ")} — cannot reach the{" "}
                  {minSquadSize}-player minimum at the current average price.
                </span>
              </div>
            )}

            <TeamStandingsTable standings={standings} ranks={qualifiedRank} />
          </section>

          {/* ---------------- pools & roles ---------------- */}
          <section className="grid gap-8 lg:grid-cols-2">
            <ProgressGroup
              title="Sell-through by pool"
              groups={byPool}
              caption="Bars show lots sold out of each pool; pools run in bidding order."
            />
            <ProgressGroup
              title="Sell-through by role"
              groups={byRole}
              caption="Where the money is going, by squad role."
            />
          </section>

          {/* ---------------- status + audit ---------------- */}
          <section className="grid gap-8 lg:grid-cols-2">
            <div className="space-y-3">
              <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
                Lot status
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {["available", "active", "sold", "unsold", "recalled"].map((s) => (
                  <StatTile key={s} label={s} value={statusCounts[s] ?? 0} />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
                Recent activity
              </h2>
              {(auditEvents ?? []).length === 0 ? (
                <EmptyState title="No auction events yet" />
              ) : (
                <ul className="space-y-1 text-sm text-ink-2">
                  {(auditEvents ?? []).map((e) => (
                    <li key={e.id} className="flex gap-2">
                      <span className="font-mono text-xs text-ink-3">
                        {timeFmt.format(new Date(e.created_at))}
                      </span>
                      <span>{e.kind.replace(/_/g, " ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function TeamStandingsTable({
  standings,
  ranks,
}: {
  standings: TeamStanding[];
  ranks: Map<string, number | null>;
}) {
  const columns: DataTableColumn<TeamStanding>[] = [
    {
      key: "rank",
      header: "#",
      render: (t) => {
        const r = ranks.get(t.teamId);
        return r != null ? <span className="font-mono text-xs text-ink-3">{r}</span> : "—";
      },
    },
    {
      key: "team",
      header: "Team",
      render: (t) => (
        <span>
          <span className="block text-sm font-medium">{t.franchise ?? t.name}</span>
          {t.franchise && <span className="block text-xs text-ink-3">{t.name}</span>}
        </span>
      ),
    },
    { key: "squad", header: "Squad", render: (t) => t.squadSize },
    { key: "overseas", header: "Overseas", render: (t) => t.overseasCount },
    { key: "spend", header: "Spent", render: (t) => <Money value={t.spend} className="text-xs" /> },
    {
      key: "balance",
      header: "Purse left",
      render: (t) => <Money value={t.balance} className="text-xs" />,
    },
    {
      key: "avg",
      header: "Avg / player",
      render: (t) => (t.averagePrice != null ? <Money value={t.averagePrice} className="text-xs" /> : "—"),
    },
    {
      key: "headroom",
      header: "Per slot left",
      render: (t) =>
        t.perSlotHeadroom != null ? (
          <Money value={t.perSlotHeadroom} className="text-xs" />
        ) : (
          <span className="text-xs text-ink-3">minimum met</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={standings}
      rowKey={(t) => t.teamId}
      emptyTitle="No teams seated"
      emptyDescription="Assign franchises in Auction setup to scope this table to the bidding teams."
    />
  );
}

/**
 * Sell-through as single-hue magnitude bars — one measure, one hue, each bar
 * directly labelled, no legend (the heading names the measure). Realisation
 * is printed as text beside each bar rather than encoded as a second colour.
 */
function ProgressGroup({
  title,
  groups,
  caption,
}: {
  title: string;
  groups: GroupProgress[];
  caption: string;
}) {
  return (
    <div className="space-y-3">
      <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">{title}</h2>
      {groups.length === 0 ? (
        <EmptyState title="Nothing to show yet" />
      ) : (
        <>
          <div className="space-y-2.5">
            {groups.map((g) => (
              <MeterBar
                key={g.key}
                label={g.key}
                value={g.sold}
                max={g.total}
                detail={
                  g.realisation != null
                    ? `${pct(g.realisation)} of base${g.unsold ? ` · ${g.unsold} unsold` : ""}`
                    : g.unsold
                      ? `${g.unsold} unsold`
                      : undefined
                }
              />
            ))}
          </div>
          <p className="text-xs text-ink-3">{caption}</p>
        </>
      )}
    </div>
  );
}
