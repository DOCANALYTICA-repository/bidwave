import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  withTx,
  createTestAdmin,
  createTestTeam,
  createTestPlayer,
  createTestAuctionRuleSet,
  grantTestPurse,
  expectRejection,
} from "./helpers/db";

/**
 * The trade block — execute_trade / reverse_trade.
 *
 * Every test builds its own throwaway event edition rather than using the live
 * one. `auction_rule_sets_one_active` is unique per edition, so a fixture rule
 * set inserted against bidwave-2026 collides with the real one that the actual
 * auction is running on (that collision is what breaks analytics.test.ts and
 * auction.test.ts on this hosted DB today). A fresh, inactive edition has no
 * such clash and needs nothing cleaned up — withTx rolls the whole thing back.
 */
async function createTestEdition(client: Client, label: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.event_editions (name, slug, starts_on, ends_on, is_active)
     values ($1, $2, '2026-08-17', '2026-08-19', false)
     returning id`,
    [`Trade fixture ${label}`, `trade-fixture-${label}-${Math.random().toString(36).slice(2, 10)}`],
  );
  return rows[0]!.id;
}

type Fixture = {
  editionId: string;
  adminId: string;
  teamA: string;
  teamB: string;
  ruleSetId: string;
};

async function setup(
  client: Client,
  label: string,
  ruleSet: { maxSquadSize?: number; maxOverseas?: number; roleLimits?: Record<string, unknown> } = {},
): Promise<Fixture> {
  const editionId = await createTestEdition(client, label);
  const adminId = await createTestAdmin(client);
  const teamA = await createTestTeam(client, { name: `Alpha ${label}`, eventEditionId: editionId });
  const teamB = await createTestTeam(client, { name: `Bravo ${label}`, eventEditionId: editionId });
  const ruleSetId = await createTestAuctionRuleSet(client, {
    eventEditionId: editionId,
    maxSquadSize: 5,
    maxOverseas: 2,
    ...ruleSet,
  });
  await grantTestPurse(client, { eventEditionId: editionId, teamId: teamA, amount: 1000 });
  await grantTestPurse(client, { eventEditionId: editionId, teamId: teamB, amount: 1000 });
  return { editionId, adminId, teamA, teamB, ruleSetId };
}

/** Sells a player straight to a team, the same end state record_sale produces. */
async function sellTo(
  client: Client,
  fx: Fixture,
  opts: { name: string; teamId: string; price: number; isOverseas?: boolean; role?: string },
): Promise<string> {
  const player = await createTestPlayer(client, {
    eventEditionId: fx.editionId,
    fullName: opts.name,
    isOverseas: opts.isOverseas,
    role: opts.role,
  });
  await client.query(
    `update public.players
       set status = 'sold', current_team_id = $1, sale_price = $2, sold_at = now()
     where id = $3`,
    [opts.teamId, opts.price, player.id],
  );
  await client.query(
    `insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount)
     values ($1, $2, 'purchase', $3)`,
    [fx.editionId, opts.teamId, -opts.price],
  );
  return player.id;
}

async function balance(client: Client, teamId: string): Promise<number> {
  const { rows } = await client.query<{ balance: string }>(
    "select coalesce(sum(amount), 0)::text as balance from public.purse_ledger where team_id = $1",
    [teamId],
  );
  return Number(rows[0]!.balance);
}

async function squad(client: Client, teamId: string): Promise<string[]> {
  const { rows } = await client.query<{ full_name: string }>(
    `select full_name from public.players
      where current_team_id = $1 and status = 'sold' order by full_name`,
    [teamId],
  );
  return rows.map((r) => r.full_name);
}

const EXECUTE = `select public.execute_trade($1, $2, $3, $4::uuid[], $5::uuid[], $6, $7, $8, $9) as r`;

describe("execute_trade — players and cash both ways", () => {
  it("moves players between squads and nets the cash in the purse ledger", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "both-ways");
      const gill = await sellTo(client, fx, { name: "Gill", teamId: fx.teamA, price: 100 });
      const pant = await sellTo(client, fx, { name: "Pant", teamId: fx.teamB, price: 80 });

      const beforeA = await balance(client, fx.teamA);
      const beforeB = await balance(client, fx.teamB);

      await client.query(EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [gill], [pant], 50, 20, "Gill for Pant", fx.adminId,
      ]);

      expect(await squad(client, fx.teamA)).toEqual(["Pant"]);
      expect(await squad(client, fx.teamB)).toEqual(["Gill"]);
      // A sends 50 and receives 20 -> net -30; B is the exact mirror.
      expect(await balance(client, fx.teamA)).toBe(beforeA - 30);
      expect(await balance(client, fx.teamB)).toBe(beforeB + 30);
    });
  });

  it("records both legs with the price the player carried at the time", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "legs");
      const gill = await sellTo(client, fx, { name: "Gill", teamId: fx.teamA, price: 100 });

      await client.query(EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [gill], [], 0, 0, null, fx.adminId,
      ]);

      const { rows } = await client.query(
        `select from_team_id, to_team_id, price_at_trade::text from public.auction_trade_players
          where player_id = $1`,
        [gill],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.from_team_id).toBe(fx.teamA);
      expect(rows[0]!.to_team_id).toBe(fx.teamB);
      expect(Number(rows[0]!.price_at_trade)).toBe(100);
    });
  });

  it("leaves auction_sales and players.sale_price untouched", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "provenance");
      const gill = await sellTo(client, fx, { name: "Gill", teamId: fx.teamA, price: 100 });
      await client.query(
        `insert into public.auction_sales (event_edition_id, player_id, team_id, amount)
         values ($1, $2, $3, 100)`,
        [fx.editionId, gill, fx.teamA],
      );

      await client.query(EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [gill], [], 0, 0, null, fx.adminId,
      ]);

      // The auction record still names the original buyer — a trade is a later
      // event, not a rewrite of what happened under the hammer.
      const { rows: sales } = await client.query(
        "select team_id from public.auction_sales where player_id = $1",
        [gill],
      );
      expect(sales[0]!.team_id).toBe(fx.teamA);

      const { rows: player } = await client.query(
        "select sale_price::text, status, current_team_id from public.players where id = $1",
        [gill],
      );
      expect(Number(player[0]!.sale_price)).toBe(100);
      expect(player[0]!.status).toBe("sold");
      expect(player[0]!.current_team_id).toBe(fx.teamB);
    });
  });

  it("allows a cash-only trade", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "cash-only");
      const beforeB = await balance(client, fx.teamB);

      await client.query(EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [], [], 200, 0, "Cash for a future pick", fx.adminId,
      ]);

      expect(await balance(client, fx.teamB)).toBe(beforeB + 200);
    });
  });

  it("broadcasts on the auction topic so every live surface repaints", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "broadcast");
      const gill = await sellTo(client, fx, { name: "Gill", teamId: fx.teamA, price: 100 });

      await client.query(EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [gill], [], 0, 0, null, fx.adminId,
      ]);

      const { rows } = await client.query(
        "select topic, kind from public.live_broadcast where event_edition_id = $1 order by id desc limit 1",
        [fx.editionId],
      );
      expect(rows[0]).toMatchObject({ topic: "auction", kind: "trade" });
    });
  });
});

describe("execute_trade — refusals", () => {
  it("refuses a player who is not on the sending franchise's squad", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "wrong-roster");
      const pant = await sellTo(client, fx, { name: "Pant", teamId: fx.teamB, price: 80 });

      const err = await expectRejection(client, EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [pant], [], 0, 0, null, fx.adminId,
      ]);
      expect(err.message).toMatch(/player_not_on_roster/);
    });
  });

  it("refuses cash a franchise does not have", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "broke");
      // A holds 1000 start less nothing; 1500 out is more than exists.
      const err = await expectRejection(client, EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [], [], 1500, 0, null, fx.adminId,
      ]);
      expect(err.message).toMatch(/trade_blocked/);
    });
  });

  it("refuses a trade that pushes the receiving squad past max_squad_size", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "squad-cap", { maxSquadSize: 2 });
      const p1 = await sellTo(client, fx, { name: "A1", teamId: fx.teamA, price: 10 });
      const p2 = await sellTo(client, fx, { name: "A2", teamId: fx.teamA, price: 10 });
      await sellTo(client, fx, { name: "B1", teamId: fx.teamB, price: 10 });
      await sellTo(client, fx, { name: "B2", teamId: fx.teamB, price: 10 });

      const err = await expectRejection(client, EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [p1, p2], [], 0, 0, null, fx.adminId,
      ]);
      expect(err.message).toMatch(/trade_blocked/);
    });
  });

  it("allows an even swap that would fail a one-at-a-time cap check", async () => {
    await withTx(async (client) => {
      // Both squads are already full at max_squad_size. Checking each incoming
      // player on its own (as record_sale must) would reject this; the net
      // state is unchanged, so the trade is legal.
      const fx = await setup(client, "even-swap", { maxSquadSize: 1 });
      const a1 = await sellTo(client, fx, { name: "A1", teamId: fx.teamA, price: 10 });
      const b1 = await sellTo(client, fx, { name: "B1", teamId: fx.teamB, price: 10 });

      await client.query(EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [a1], [b1], 0, 0, null, fx.adminId,
      ]);

      expect(await squad(client, fx.teamA)).toEqual(["B1"]);
      expect(await squad(client, fx.teamB)).toEqual(["A1"]);
    });
  });

  it("refuses a trade that breaches the overseas cap", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "overseas", { maxOverseas: 1 });
      const o1 = await sellTo(client, fx, { name: "O1", teamId: fx.teamA, price: 10, isOverseas: true });
      await sellTo(client, fx, { name: "O2", teamId: fx.teamB, price: 10, isOverseas: true });

      const err = await expectRejection(client, EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [o1], [], 0, 0, null, fx.adminId,
      ]);
      expect(err.message).toMatch(/trade_blocked/);
    });
  });

  it("refuses an empty trade, a self-trade and a non-admin", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "degenerate");

      const empty = await expectRejection(client, EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [], [], 0, 0, null, fx.adminId,
      ]);
      expect(empty.message).toMatch(/invalid_trade/);

      const self = await expectRejection(client, EXECUTE, [
        fx.editionId, fx.teamA, fx.teamA, [], [], 10, 0, null, fx.adminId,
      ]);
      expect(self.message).toMatch(/invalid_trade/);

      const notAdmin = await expectRejection(client, EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [], [], 10, 0, null, fx.teamA,
      ]);
      expect(notAdmin.message).toMatch(/admin_required/);
    });
  });

  it("refuses the same player moving in both directions", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "both-dirs");
      const gill = await sellTo(client, fx, { name: "Gill", teamId: fx.teamA, price: 100 });

      const err = await expectRejection(client, EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [gill], [gill], 0, 0, null, fx.adminId,
      ]);
      expect(err.message).toMatch(/invalid_trade/);
    });
  });

  it("writes nothing at all when a trade is blocked", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "atomic");
      const p1 = await sellTo(client, fx, { name: "A1", teamId: fx.teamA, price: 10 });
      const before = await balance(client, fx.teamA);

      await expectRejection(client, EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [p1], [], 5000, 0, null, fx.adminId,
      ]);

      // Zero partial writes: no trade header, no leg, no ledger movement, and
      // the player is still where they started.
      const { rows: trades } = await client.query(
        "select count(*)::int as n from public.auction_trades where event_edition_id = $1",
        [fx.editionId],
      );
      expect(trades[0]!.n).toBe(0);
      expect(await balance(client, fx.teamA)).toBe(before);
      expect(await squad(client, fx.teamA)).toEqual(["A1"]);
    });
  });
});

describe("reverse_trade", () => {
  it("puts every player back and posts equal and opposite ledger entries", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "reverse");
      const gill = await sellTo(client, fx, { name: "Gill", teamId: fx.teamA, price: 100 });
      const pant = await sellTo(client, fx, { name: "Pant", teamId: fx.teamB, price: 80 });
      const beforeA = await balance(client, fx.teamA);
      const beforeB = await balance(client, fx.teamB);

      const { rows } = await client.query<{ r: { trade_id: string } }>(EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [gill], [pant], 50, 20, null, fx.adminId,
      ]);
      const tradeId = rows[0]!.r.trade_id;

      await client.query("select public.reverse_trade($1, $2, $3)", [tradeId, "Mis-heard", fx.adminId]);

      expect(await squad(client, fx.teamA)).toEqual(["Gill"]);
      expect(await squad(client, fx.teamB)).toEqual(["Pant"]);
      expect(await balance(client, fx.teamA)).toBe(beforeA);
      expect(await balance(client, fx.teamB)).toBe(beforeB);

      // Undone by compensation, not deletion — the ledger is append-only, so
      // the original 'trade' rows must still be there alongside the reversals.
      const { rows: entries } = await client.query<{ entry_kind: string; n: number }>(
        `select entry_kind, count(*)::int as n from public.purse_ledger
          where ref_kind = 'auction_trades' and ref_id = $1 group by entry_kind order by entry_kind`,
        [tradeId],
      );
      expect(entries).toEqual([
        { entry_kind: "reversal", n: 2 },
        { entry_kind: "trade", n: 2 },
      ]);
    });
  });

  it("refuses to reverse twice", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "twice");
      const gill = await sellTo(client, fx, { name: "Gill", teamId: fx.teamA, price: 100 });
      const { rows } = await client.query<{ r: { trade_id: string } }>(EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [gill], [], 0, 0, null, fx.adminId,
      ]);
      const tradeId = rows[0]!.r.trade_id;

      await client.query("select public.reverse_trade($1, $2, $3)", [tradeId, "once", fx.adminId]);
      const err = await expectRejection(client, "select public.reverse_trade($1, $2, $3)", [
        tradeId, "twice", fx.adminId,
      ]);
      expect(err.message).toMatch(/already_reversed/);
    });
  });

  it("refuses when a traded player has since moved on", async () => {
    await withTx(async (client) => {
      const fx = await setup(client, "moved-on");
      const teamC = await createTestTeam(client, { name: "Charlie moved-on", eventEditionId: fx.editionId });
      await grantTestPurse(client, { eventEditionId: fx.editionId, teamId: teamC, amount: 1000 });
      const gill = await sellTo(client, fx, { name: "Gill", teamId: fx.teamA, price: 100 });

      const { rows } = await client.query<{ r: { trade_id: string } }>(EXECUTE, [
        fx.editionId, fx.teamA, fx.teamB, [gill], [], 0, 0, null, fx.adminId,
      ]);
      const tradeId = rows[0]!.r.trade_id;

      // B trades Gill straight on to C. The first trade can no longer be
      // unwound without silently reaching into C's squad.
      await client.query(EXECUTE, [
        fx.editionId, fx.teamB, teamC, [gill], [], 0, 0, null, fx.adminId,
      ]);

      const err = await expectRejection(client, "select public.reverse_trade($1, $2, $3)", [
        tradeId, "too late", fx.adminId,
      ]);
      expect(err.message).toMatch(/trade_no_longer_current/);
    });
  });
});
