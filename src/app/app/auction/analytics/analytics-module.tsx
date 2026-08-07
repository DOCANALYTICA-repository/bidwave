import { EmptyState, Money, MeterBar, StatTile } from "@/components/bidwave";
import { PoweredByCredit } from "@/components/bidwave/powered-by-credit";
import { PlayerCompare } from "@/app/app/auction/analytics/player-compare";

type Player = {
  id: string;
  full_name: string;
  role: string;
  pool: string;
  base_price: number;
  status: string;
  is_overseas: boolean;
  current_team_id: string | null;
  stats: Record<string, unknown> | null;
};
type StatDef = { key: string; label: string; data_type: string };
type RuleSet = {
  min_squad_size: number;
  max_squad_size: number;
  max_overseas: number;
  role_limits: Record<string, { max?: number } | undefined> | null;
  pool_limits: Record<string, { max?: number } | undefined> | null;
};

/**
 * §17.2/AN-07: every section degrades to an EmptyState when its backing
 * data is genuinely absent — real player stats (DEP-05) haven't arrived, so
 * most of this renders honestly-empty against production data today. That
 * is correct behavior, not a bug: nothing here fabricates a value signal
 * the module never told the reader about (see the undervalued-opportunities
 * section specifically).
 */
export function AnalyticsModule({
  roster,
  availablePlayers,
  ruleSet,
  balance,
  statDefs,
}: {
  roster: Player[];
  availablePlayers: Player[];
  ruleSet: RuleSet | null;
  balance: number;
  statDefs: StatDef[];
}) {
  const roleCounts = countBy(roster, (p) => p.role);
  const poolCounts = countBy(roster, (p) => p.pool);
  const overseasCount = roster.filter((p) => p.is_overseas).length;

  const affordable = availablePlayers
    .filter((p) => p.base_price <= balance)
    .sort((a, b) => a.base_price - b.base_price)
    .slice(0, 10);

  const numericStatDefs = statDefs.filter((d) => d.data_type === "number");
  const allPlayersForCompare = [...roster, ...availablePlayers];

  // A "value" signal must come from real performance data, never be
  // synthesized from sale_price ÷ base_price — this section only renders
  // once at least one numeric stat is actually populated somewhere.
  const hasRealValueSignal = numericStatDefs.some((def) =>
    availablePlayers.some((p) => p.stats?.[def.key] != null),
  );

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <PoweredByCredit size="lg" />
      </div>

      <Section title="Squad balance & gaps">
        {roster.length === 0 ? (
          <EmptyState title="No players sold to your squad yet" description="Bars fill in as you win players at auction." />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">By role</p>
              {Object.entries(roleCounts).map(([role, count]) => (
                <MeterBar
                  key={role}
                  label={role}
                  value={count}
                  max={ruleSet?.role_limits?.[role]?.max ?? 0}
                  tone={
                    ruleSet?.role_limits?.[role]?.max && count > (ruleSet.role_limits[role]!.max ?? Infinity)
                      ? "danger"
                      : "analytics"
                  }
                />
              ))}
            </div>
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">By pool</p>
              {Object.entries(poolCounts).map(([pool, count]) => (
                <MeterBar
                  key={pool}
                  label={`Pool ${pool}`}
                  value={count}
                  max={ruleSet?.pool_limits?.[pool]?.max ?? 0}
                />
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Rule compliance">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Squad size"
            value={roster.length}
            tone={
              !ruleSet || (roster.length >= ruleSet.min_squad_size && roster.length <= ruleSet.max_squad_size)
                ? "default"
                : "danger"
            }
          />
          <StatTile
            label="Overseas"
            value={overseasCount}
            tone={!ruleSet || overseasCount <= ruleSet.max_overseas ? "default" : "danger"}
          />
          <StatTile label="Purse remaining" value={<Money value={balance} />} tone="gold" />
        </div>
      </Section>

      <Section title="Recommendations">
        <Recommendations
          roleCounts={roleCounts}
          poolCounts={poolCounts}
          ruleSet={ruleSet}
          affordablePlayers={availablePlayers.filter((p) => p.base_price <= balance)}
        />
      </Section>

      <Section title="Purse-aware affordable targets">
        {affordable.length === 0 ? (
          <EmptyState
            title="No affordable targets right now"
            description="Available players within your remaining purse will appear here."
          />
        ) : (
          <ul className="space-y-1.5">
            {affordable.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>
                  {p.full_name} <span className="text-xs text-ink-3">({p.role} · Pool {p.pool})</span>
                </span>
                <Money value={p.base_price} className="text-xs" />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Undervalued-player opportunities">
        {hasRealValueSignal ? (
          <UndervaluedList players={availablePlayers} statDefs={numericStatDefs} />
        ) : (
          <EmptyState
            title="Needs player performance data"
            description="This section activates once real performance stats are imported — it never estimates value from price alone."
          />
        )}
      </Section>

      <Section title="Player profiles & head-to-head">
        {allPlayersForCompare.length === 0 ? (
          <EmptyState title="No players in the pool yet" />
        ) : (
          <PlayerCompare players={allPlayersForCompare} statDefs={statDefs} />
        )}
      </Section>
    </div>
  );
}

function UndervaluedList({ players, statDefs }: { players: Player[]; statDefs: StatDef[] }) {
  const primary = statDefs[0];
  const ranked = players
    .filter((p) => p.stats?.[primary.key] != null)
    .sort((a, b) => Number(b.stats?.[primary.key]) / b.base_price - Number(a.stats?.[primary.key]) / a.base_price)
    .slice(0, 8);

  return (
    <ul className="space-y-1.5">
      {ranked.map((p) => (
        <li key={p.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
          <span>
            {p.full_name} <span className="text-xs text-ink-3">({p.role})</span>
          </span>
          <span className="font-mono text-xs text-analytics">
            {primary.label}: {String(p.stats?.[primary.key])} · <Money value={p.base_price} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-analytics">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Phase 5: gap-aware "fill this gap" recommendations — for each role/pool
 * still below ruleSet's minimum (role_limits/pool_limits carry a `max`,
 * not a `min`, so a squad-size gap against min_squad_size is the only
 * general-purpose signal available without per-role minimums the schema
 * doesn't have), rank affordable available players by role/pool match and
 * surface the purse cost of taking each. Degrades to an EmptyState rather
 * than fabricating urgency when there's no real gap or nothing affordable
 * — same principle as the undervalued-opportunities section above.
 */
function Recommendations({
  roleCounts,
  poolCounts,
  ruleSet,
  affordablePlayers,
}: {
  roleCounts: Record<string, number>;
  poolCounts: Record<string, number>;
  ruleSet: RuleSet | null;
  affordablePlayers: Player[];
}) {
  const squadGap = ruleSet ? Math.max(0, ruleSet.min_squad_size - Object.values(roleCounts).reduce((a, b) => a + b, 0)) : 0;

  if (!ruleSet || squadGap === 0 || affordablePlayers.length === 0) {
    return (
      <EmptyState
        title="No open gaps to fill"
        description="Recommendations appear once your squad is below the minimum size and there are affordable players available."
      />
    );
  }

  // Roles you have the fewest of are the most likely gap — a heuristic in
  // the absence of per-role minimums, not a claim about what the ruleset
  // actually requires.
  const rolesByScarcity = Object.entries(roleCounts).sort((a, b) => a[1] - b[1]).map(([role]) => role);
  const scarcityRank = new Map(rolesByScarcity.map((role, i) => [role, i]));

  const ranked = [...affordablePlayers]
    .sort((a, b) => (scarcityRank.get(a.role) ?? 99) - (scarcityRank.get(b.role) ?? 99) || a.base_price - b.base_price)
    .slice(0, 6);

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-2">
        Your squad is {squadGap} player{squadGap === 1 ? "" : "s"} below the minimum. Ranked by role scarcity in your
        current roster, then by affordability.
      </p>
      <ul className="space-y-1.5">
        {ranked.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
            <span>
              {p.full_name}{" "}
              <span className="text-xs text-ink-3">
                ({p.role} · Pool {p.pool} · {roleCounts[p.role] ?? 0} on roster, {poolCounts[p.pool] ?? 0} in pool)
              </span>
            </span>
            <Money value={p.base_price} className="text-xs" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce(
    (acc, item) => {
      const k = key(item);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
}
