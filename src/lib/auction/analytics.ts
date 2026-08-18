/**
 * Pure aggregation for the admin auction dashboard. No Supabase calls in
 * here — every function takes rows the page already fetched, so the whole
 * module is unit-testable and can be reused by the console without a second
 * round of queries.
 */

export type PlayerRow = {
  id: string;
  full_name: string;
  role: string;
  pool: string;
  status: string;
  is_overseas: boolean;
  base_price: number;
  sale_price: number | null;
  current_team_id: string | null;
  sold_at: string | null;
};

export type SaleRow = {
  id: string;
  player_id: string;
  team_id: string;
  amount: number;
  sold_at: string;
  reversed_at: string | null;
};

export type TeamRow = { team_id: string; name: string; purse_balance: number };

/**
 * Per-team squad shape. Lifted from the fold that admin/auction/console/
 * page.tsx already does inline, so the console and this dashboard cannot
 * drift apart on what "squad size" or "overseas count" means.
 */
export type RosterSummary = {
  squadSize: number;
  overseasCount: number;
  spend: number;
  roleCounts: Record<string, number>;
  poolCounts: Record<string, number>;
};

export function summariseRosters(players: PlayerRow[]): Record<string, RosterSummary> {
  const out: Record<string, RosterSummary> = {};
  for (const p of players) {
    if (p.status !== "sold" || !p.current_team_id) continue;
    const s = (out[p.current_team_id] ??= {
      squadSize: 0,
      overseasCount: 0,
      spend: 0,
      roleCounts: {},
      poolCounts: {},
    });
    s.squadSize += 1;
    if (p.is_overseas) s.overseasCount += 1;
    s.spend += Number(p.sale_price ?? 0);
    s.roleCounts[p.role] = (s.roleCounts[p.role] ?? 0) + 1;
    s.poolCounts[p.pool] = (s.poolCounts[p.pool] ?? 0) + 1;
  }
  return out;
}

export type GroupProgress = {
  key: string;
  total: number;
  sold: number;
  unsold: number;
  remaining: number;
  spend: number;
  baseOfSold: number;
  /** Sale total ÷ base total for sold lots. 1 = went at base. null = none sold. */
  realisation: number | null;
};

function emptyGroup(key: string): GroupProgress {
  return { key, total: 0, sold: 0, unsold: 0, remaining: 0, spend: 0, baseOfSold: 0, realisation: null };
}

/** Sell-through and price realisation grouped by any player field. */
export function groupProgress(players: PlayerRow[], by: (p: PlayerRow) => string): GroupProgress[] {
  const map = new Map<string, GroupProgress>();
  for (const p of players) {
    const key = by(p);
    const g = map.get(key) ?? emptyGroup(key);
    g.total += 1;
    if (p.status === "sold") {
      g.sold += 1;
      g.spend += Number(p.sale_price ?? 0);
      g.baseOfSold += Number(p.base_price ?? 0);
    } else if (p.status === "unsold") {
      g.unsold += 1;
    } else {
      g.remaining += 1;
    }
    map.set(key, g);
  }
  for (const g of map.values()) {
    g.realisation = g.baseOfSold > 0 ? g.spend / g.baseOfSold : null;
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export type MarketPulse = {
  lotsSold: number;
  lotsUnsold: number;
  lotsRemaining: number;
  totalSpend: number;
  baseOfSold: number;
  /** Overall sale ÷ base for sold lots — the headline auction number. */
  realisation: number | null;
  averagePrice: number | null;
  medianPrice: number | null;
  highestSale: { name: string; amount: number } | null;
  /** Realisation over the first vs last third of sales, in sale order. */
  earlyRealisation: number | null;
  lateRealisation: number | null;
};

export function computeMarketPulse(players: PlayerRow[]): MarketPulse {
  const sold = players
    .filter((p) => p.status === "sold")
    .sort((a, b) => (a.sold_at ?? "").localeCompare(b.sold_at ?? ""));

  const prices = sold.map((p) => Number(p.sale_price ?? 0));
  const totalSpend = prices.reduce((a, b) => a + b, 0);
  const baseOfSold = sold.reduce((a, p) => a + Number(p.base_price ?? 0), 0);

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const median = sortedPrices.length
    ? sortedPrices.length % 2
      ? sortedPrices[(sortedPrices.length - 1) / 2]
      : (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
    : null;

  const highest = sold.reduce<{ name: string; amount: number } | null>((best, p) => {
    const amount = Number(p.sale_price ?? 0);
    return !best || amount > best.amount ? { name: p.full_name, amount } : best;
  }, null);

  const realisationOf = (rows: PlayerRow[]) => {
    const base = rows.reduce((a, p) => a + Number(p.base_price ?? 0), 0);
    const spend = rows.reduce((a, p) => a + Number(p.sale_price ?? 0), 0);
    return base > 0 ? spend / base : null;
  };

  // Thirds, not halves: with a long auction the middle is the steady state and
  // the interesting comparison is opening frenzy vs endgame bargain-hunting.
  const third = Math.floor(sold.length / 3);
  return {
    lotsSold: sold.length,
    lotsUnsold: players.filter((p) => p.status === "unsold").length,
    lotsRemaining: players.filter((p) => p.status === "available" || p.status === "active").length,
    totalSpend,
    baseOfSold,
    realisation: baseOfSold > 0 ? totalSpend / baseOfSold : null,
    averagePrice: sold.length ? totalSpend / sold.length : null,
    medianPrice: median,
    highestSale: highest,
    earlyRealisation: third >= 2 ? realisationOf(sold.slice(0, third)) : null,
    lateRealisation: third >= 2 ? realisationOf(sold.slice(-third)) : null,
  };
}

/** Sale prices in chronological order, for the timeline sparkline. */
export function saleTimeline(players: PlayerRow[]): { values: number[]; labels: string[] } {
  const sold = players
    .filter((p) => p.status === "sold" && p.sold_at)
    .sort((a, b) => (a.sold_at ?? "").localeCompare(b.sold_at ?? ""));
  return {
    values: sold.map((p) => Number(p.sale_price ?? 0)),
    labels: sold.map((p) => p.full_name),
  };
}

/** Cumulative spend across the auction, in sale order. */
export function cumulativeSpend(players: PlayerRow[]): number[] {
  const { values } = saleTimeline(players);
  let running = 0;
  return values.map((v) => (running += v));
}

export type TeamStanding = {
  teamId: string;
  name: string;
  franchise: string | null;
  balance: number;
  spend: number;
  squadSize: number;
  overseasCount: number;
  averagePrice: number | null;
  /** Purse left ÷ slots still needed to reach the minimum squad. */
  perSlotHeadroom: number | null;
  slotsToMinimum: number;
};

export function computeTeamStandings(
  teams: TeamRow[],
  rosters: Record<string, RosterSummary>,
  franchises: Record<string, string>,
  minSquadSize: number,
): TeamStanding[] {
  return teams
    .map((t) => {
      const r = rosters[t.team_id];
      const squadSize = r?.squadSize ?? 0;
      const spend = r?.spend ?? 0;
      const slotsToMinimum = Math.max(0, minSquadSize - squadSize);
      return {
        teamId: t.team_id,
        name: t.name,
        franchise: franchises[t.team_id] ?? null,
        balance: Number(t.purse_balance ?? 0),
        spend,
        squadSize,
        overseasCount: r?.overseasCount ?? 0,
        averagePrice: squadSize > 0 ? spend / squadSize : null,
        perSlotHeadroom: slotsToMinimum > 0 ? Number(t.purse_balance ?? 0) / slotsToMinimum : null,
        slotsToMinimum,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

/** Teams that cannot reach the minimum squad at the current going rate. */
export function teamsAtRisk(standings: TeamStanding[], averagePrice: number | null): TeamStanding[] {
  if (!averagePrice || averagePrice <= 0) return [];
  return standings.filter(
    (s) => s.slotsToMinimum > 0 && s.balance < s.slotsToMinimum * averagePrice,
  );
}
