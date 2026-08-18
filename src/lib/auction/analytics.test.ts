import { describe, expect, it } from "vitest";
import {
  buildSquads,
  buildTeamTrackers,
  cheapestRemainingBase,
  computeMarketPulse,
  computeTeamStandings,
  cumulativeSpend,
  groupProgress,
  saleTimeline,
  summarisePurseLedger,
  summariseRosters,
  teamsAtRisk,
  type PlayerRow,
} from "@/lib/auction/analytics";

function player(over: Partial<PlayerRow> & { id: string }): PlayerRow {
  return {
    full_name: `Player ${over.id}`,
    role: "BATTER",
    pool: "POT 01 · MARQUEE 1",
    status: "available",
    is_overseas: false,
    base_price: 10_000_000,
    sale_price: null,
    current_team_id: null,
    sold_at: null,
    ...over,
  };
}

const sold = (id: string, amount: number, at: string, over: Partial<PlayerRow> = {}) =>
  player({ id, status: "sold", sale_price: amount, sold_at: at, current_team_id: "t1", ...over });

describe("summariseRosters", () => {
  it("counts only sold players, per owning team", () => {
    const out = summariseRosters([
      sold("a", 20_000_000, "2026-08-18T10:00:00Z", { is_overseas: true }),
      sold("b", 10_000_000, "2026-08-18T10:01:00Z", { role: "BOWLER" }),
      sold("c", 30_000_000, "2026-08-18T10:02:00Z", { current_team_id: "t2" }),
      // Neither of these should land in any roster.
      player({ id: "d", status: "available" }),
      player({ id: "e", status: "unsold" }),
    ]);

    expect(out.t1.squadSize).toBe(2);
    expect(out.t1.overseasCount).toBe(1);
    expect(out.t1.spend).toBe(30_000_000);
    expect(out.t1.roleCounts).toEqual({ BATTER: 1, BOWLER: 1 });
    expect(out.t2.squadSize).toBe(1);
  });

  it("ignores sold players with no owning team rather than crashing", () => {
    const out = summariseRosters([
      player({ id: "a", status: "sold", sale_price: 5_000_000, current_team_id: null }),
    ]);
    expect(out).toEqual({});
  });
});

describe("computeMarketPulse", () => {
  it("computes realisation as spend over base of sold lots only", () => {
    const pulse = computeMarketPulse([
      sold("a", 20_000_000, "2026-08-18T10:00:00Z", { base_price: 10_000_000 }),
      sold("b", 10_000_000, "2026-08-18T10:01:00Z", { base_price: 10_000_000 }),
      // An unsold lot's base price must NOT dilute realisation.
      player({ id: "c", status: "unsold", base_price: 90_000_000 }),
    ]);

    expect(pulse.lotsSold).toBe(2);
    expect(pulse.lotsUnsold).toBe(1);
    expect(pulse.totalSpend).toBe(30_000_000);
    expect(pulse.baseOfSold).toBe(20_000_000);
    expect(pulse.realisation).toBe(1.5);
    expect(pulse.averagePrice).toBe(15_000_000);
  });

  it("returns null rather than dividing by zero when nothing has sold", () => {
    const pulse = computeMarketPulse([player({ id: "a" }), player({ id: "b" })]);
    expect(pulse.realisation).toBeNull();
    expect(pulse.averagePrice).toBeNull();
    expect(pulse.medianPrice).toBeNull();
    expect(pulse.highestSale).toBeNull();
    expect(pulse.lotsRemaining).toBe(2);
  });

  it("takes the median across an even count as the mean of the middle two", () => {
    const pulse = computeMarketPulse([
      sold("a", 10_000_000, "2026-08-18T10:00:00Z"),
      sold("b", 20_000_000, "2026-08-18T10:01:00Z"),
      sold("c", 30_000_000, "2026-08-18T10:02:00Z"),
      sold("d", 60_000_000, "2026-08-18T10:03:00Z"),
    ]);
    expect(pulse.medianPrice).toBe(25_000_000);
    expect(pulse.highestSale).toEqual({ name: "Player d", amount: 60_000_000 });
  });

  it("compares opening and closing thirds in sale order, not row order", () => {
    // Deliberately out of chronological order in the input.
    const pulse = computeMarketPulse([
      sold("late", 5_000_000, "2026-08-18T12:00:00Z", { base_price: 10_000_000 }),
      sold("mid", 10_000_000, "2026-08-18T11:00:00Z", { base_price: 10_000_000 }),
      sold("late2", 5_000_000, "2026-08-18T12:30:00Z", { base_price: 10_000_000 }),
      sold("early", 30_000_000, "2026-08-18T10:00:00Z", { base_price: 10_000_000 }),
      sold("early2", 30_000_000, "2026-08-18T10:30:00Z", { base_price: 10_000_000 }),
      sold("mid2", 10_000_000, "2026-08-18T11:30:00Z", { base_price: 10_000_000 }),
    ]);
    // Opening third bid 3x base; closing third bid 0.5x.
    expect(pulse.earlyRealisation).toBe(3);
    expect(pulse.lateRealisation).toBe(0.5);
  });

  it("skips the early/late split when there are too few sales to be meaningful", () => {
    const pulse = computeMarketPulse([
      sold("a", 10_000_000, "2026-08-18T10:00:00Z"),
      sold("b", 10_000_000, "2026-08-18T10:01:00Z"),
    ]);
    expect(pulse.earlyRealisation).toBeNull();
    expect(pulse.lateRealisation).toBeNull();
  });
});

describe("groupProgress", () => {
  it("splits sold / unsold / still-to-come per group", () => {
    const groups = groupProgress(
      [
        sold("a", 20_000_000, "2026-08-18T10:00:00Z", { pool: "P1", base_price: 10_000_000 }),
        player({ id: "b", pool: "P1", status: "unsold" }),
        player({ id: "c", pool: "P1", status: "available" }),
        player({ id: "d", pool: "P2", status: "active" }),
      ],
      (p) => p.pool,
    );

    const p1 = groups.find((g) => g.key === "P1")!;
    expect(p1).toMatchObject({ total: 3, sold: 1, unsold: 1, remaining: 1, realisation: 2 });
    // 'active' counts as still-to-come, not sold.
    expect(groups.find((g) => g.key === "P2")).toMatchObject({ total: 1, sold: 0, remaining: 1 });
  });
});

describe("saleTimeline / cumulativeSpend", () => {
  it("orders by sold_at and accumulates", () => {
    const rows = [
      sold("b", 20_000_000, "2026-08-18T10:01:00Z"),
      sold("a", 10_000_000, "2026-08-18T10:00:00Z"),
      sold("c", 30_000_000, "2026-08-18T10:02:00Z"),
    ];
    expect(saleTimeline(rows).values).toEqual([10_000_000, 20_000_000, 30_000_000]);
    expect(saleTimeline(rows).labels).toEqual(["Player a", "Player b", "Player c"]);
    expect(cumulativeSpend(rows)).toEqual([10_000_000, 30_000_000, 60_000_000]);
  });
});

describe("computeTeamStandings / teamsAtRisk", () => {
  const teams = [
    { team_id: "t1", name: "Alpha", purse_balance: 40_000_000 },
    { team_id: "t2", name: "Beta", purse_balance: 5_000_000 },
  ];
  const rosters = summariseRosters([
    sold("a", 20_000_000, "2026-08-18T10:00:00Z", { current_team_id: "t1" }),
    sold("b", 10_000_000, "2026-08-18T10:01:00Z", { current_team_id: "t1" }),
  ]);

  it("attaches franchise labels and per-slot headroom", () => {
    const s = computeTeamStandings(teams, rosters, { t1: "MUMBAI INDIANS" }, 4);
    const alpha = s.find((x) => x.teamId === "t1")!;
    expect(alpha.franchise).toBe("MUMBAI INDIANS");
    expect(alpha.squadSize).toBe(2);
    expect(alpha.spend).toBe(30_000_000);
    expect(alpha.averagePrice).toBe(15_000_000);
    expect(alpha.slotsToMinimum).toBe(2);
    expect(alpha.perSlotHeadroom).toBe(20_000_000);

    const beta = s.find((x) => x.teamId === "t2")!;
    expect(beta.franchise).toBeNull();
    expect(beta.averagePrice).toBeNull();
  });

  it("reports no headroom pressure once the minimum is met", () => {
    const s = computeTeamStandings(teams, rosters, {}, 2);
    const alpha = s.find((x) => x.teamId === "t1")!;
    expect(alpha.slotsToMinimum).toBe(0);
    expect(alpha.perSlotHeadroom).toBeNull();
  });

  it("flags only teams that cannot fill remaining slots at the going rate", () => {
    const s = computeTeamStandings(teams, rosters, {}, 4);
    // Average price 15,000,000 × 2 slots needed = 30,000,000 required.
    // Alpha has 40m (safe); Beta needs 4 slots × 15m = 60m but holds 5m.
    const risk = teamsAtRisk(s, 15_000_000);
    expect(risk.map((r) => r.teamId)).toEqual(["t2"]);
  });

  it("flags nobody when no price signal exists yet", () => {
    const s = computeTeamStandings(teams, rosters, {}, 4);
    expect(teamsAtRisk(s, null)).toEqual([]);
  });
});

describe("summarisePurseLedger", () => {
  const entry = (team_id: string, entry_kind: string, amount: number) => ({
    team_id,
    entry_kind,
    amount,
  });

  it("splits funding from spend using the ledger's own sign convention", () => {
    const out = summarisePurseLedger([
      entry("t1", "start", 1_250_000_000),
      entry("t1", "sim_bonus", 50_000_000),
      entry("t1", "purchase", -30_000_000),
      entry("t1", "analytics", -5_000_000),
    ]);

    expect(out.t1.funded).toBe(1_300_000_000);
    expect(out.t1.playerSpend).toBe(30_000_000);
    expect(out.t1.analyticsSpend).toBe(5_000_000);
    expect(out.t1.balance).toBe(1_265_000_000);
  });

  it("counts a mid-event correction as funding, not as a reversal", () => {
    // The 12.5cr → 125cr repair was posted as `adjustment` entries; a tracker
    // that read only `start` would have understated every purse by 10×.
    const out = summarisePurseLedger([
      entry("t1", "start", 125_000_000),
      entry("t1", "adjustment", 1_125_000_000),
    ]);
    expect(out.t1.funded).toBe(1_250_000_000);
    expect(out.t1.playerSpend).toBe(0);
    expect(out.t1.balance).toBe(1_250_000_000);
  });

  it("nets a reversal back out of player spend", () => {
    const out = summarisePurseLedger([
      entry("t1", "start", 100_000_000),
      entry("t1", "purchase", -30_000_000),
      entry("t1", "reversal", 30_000_000),
    ]);
    expect(out.t1.playerSpend).toBe(0);
    expect(out.t1.balance).toBe(100_000_000);
  });

  it("keeps teams separate and omits teams with no entries", () => {
    const out = summarisePurseLedger([entry("t1", "start", 10), entry("t2", "start", 20)]);
    expect(Object.keys(out).sort()).toEqual(["t1", "t2"]);
    expect(out.t3).toBeUndefined();
  });
});

describe("buildSquads", () => {
  it("buckets sold lots by owner, dearest first, with realisation", () => {
    const out = buildSquads([
      sold("a", 20_000_000, "2026-08-18T10:00:00Z", { base_price: 10_000_000 }),
      sold("b", 40_000_000, "2026-08-18T10:01:00Z", { base_price: 20_000_000 }),
      sold("c", 5_000_000, "2026-08-18T10:02:00Z", { current_team_id: "t2" }),
      player({ id: "d", status: "available" }),
    ]);

    expect(out.t1.map((p) => p.id)).toEqual(["b", "a"]);
    expect(out.t1[0].realisation).toBe(2);
    expect(out.t2).toHaveLength(1);
  });

  it("returns null realisation rather than dividing by a zero base", () => {
    const out = buildSquads([
      sold("a", 5_000_000, "2026-08-18T10:00:00Z", { base_price: 0 }),
    ]);
    expect(out.t1[0].realisation).toBeNull();
  });
});

describe("cheapestRemainingBase", () => {
  it("looks only at lots still to come", () => {
    expect(
      cheapestRemainingBase([
        player({ id: "a", base_price: 20_000_000 }),
        player({ id: "b", base_price: 2_000_000, status: "active" }),
        // Already gone — must not set the floor.
        sold("c", 1_000_000, "2026-08-18T10:00:00Z", { base_price: 500_000 }),
        player({ id: "d", base_price: 100_000, status: "unsold" }),
      ]),
    ).toBe(2_000_000);
  });

  it("is zero once nothing is left", () => {
    expect(cheapestRemainingBase([player({ id: "a", status: "unsold" })])).toBe(0);
  });
});

describe("buildTeamTrackers", () => {
  const limits = { minSquadSize: 3, maxSquadSize: 5, maxOverseas: 2 };
  const teamRows = [
    { team_id: "t1", name: "Alpha", purse_balance: 0 },
    { team_id: "t2", name: "Beta", purse_balance: 0 },
  ];
  const ledger = [
    { team_id: "t1", entry_kind: "start", amount: 100_000_000 },
    { team_id: "t1", entry_kind: "purchase", amount: -20_000_000 },
    { team_id: "t2", entry_kind: "start", amount: 100_000_000 },
  ];
  const roster = [sold("a", 20_000_000, "2026-08-18T10:00:00Z", { is_overseas: true })];

  it("reserves the cheapest base for each slot still owed after this lot", () => {
    const [alpha] = buildTeamTrackers(
      teamRows,
      roster,
      ledger,
      {},
      new Map([["t1", 1]]),
      limits,
      1_000_000,
    );
    // Alpha holds 80m, owns 1 of a 3-player minimum. Winning the lot in hand
    // leaves 1 more slot owed, so 1m is held back: 80m − 1m.
    expect(alpha.slotsToMinimum).toBe(2);
    expect(alpha.maxBidNow).toBe(79_000_000);
    expect(alpha.purse.balance).toBe(80_000_000);
    expect(alpha.overseasRemaining).toBe(1);
    expect(alpha.slotsToMaximum).toBe(4);
  });

  it("frees the whole balance once the minimum squad is met", () => {
    const full = [
      sold("a", 10_000_000, "2026-08-18T10:00:00Z"),
      sold("b", 10_000_000, "2026-08-18T10:01:00Z"),
      sold("c", 10_000_000, "2026-08-18T10:02:00Z"),
    ];
    const [alpha] = buildTeamTrackers(teamRows, full, ledger, {}, new Map(), limits, 1_000_000);
    expect(alpha.slotsToMinimum).toBe(0);
    expect(alpha.maxBidNow).toBe(alpha.purse.balance);
  });

  it("never reports a negative max bid", () => {
    const broke = [{ team_id: "t1", entry_kind: "start", amount: 1_000 }];
    const [alpha] = buildTeamTrackers(teamRows, [], broke, {}, new Map(), limits, 1_000_000);
    expect(alpha.maxBidNow).toBe(0);
  });

  it("orders by qualifying rank, pushing unranked teams to the bottom", () => {
    const out = buildTeamTrackers(
      teamRows,
      [],
      ledger,
      {},
      new Map([["t2", 1]]),
      limits,
      1_000_000,
    );
    expect(out.map((t) => t.teamId)).toEqual(["t2", "t1"]);
  });

  it("prefers the franchise label but keeps the registered name", () => {
    const [alpha] = buildTeamTrackers(
      teamRows,
      [],
      ledger,
      { t1: "Guwahati Mavericks" },
      new Map([["t1", 1]]),
      limits,
      1_000_000,
    );
    expect(alpha.franchise).toBe("Guwahati Mavericks");
    expect(alpha.name).toBe("Alpha");
  });
});
