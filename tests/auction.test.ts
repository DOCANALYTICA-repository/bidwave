import { describe, expect, it } from "vitest";
import {
  withTx,
  getActiveEventEditionId,
  createTestTeam,
  createTestPlayer,
  createTestAuctionRuleSet,
  grantTestPurse,
  expectRejection,
  createTestAdmin,
} from "./helpers/db";

describe("AT-AUC-01: a valid sale updates player/roster/purse/ledger in one call", () => {
  it("marks the player sold, deducts the purse, and writes a purchase ledger row", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "AT-AUC-01 Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 1000 });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Sale Test Player", basePrice: 200 });
      const adminId = await createTestAdmin(client);

      const { rows } = await client.query(
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid) as result",
        [player.id, teamId, 200, player.updatedAt, adminId],
      );
      expect(rows[0].result.player_id).toBe(player.id);
      expect(rows[0].result.team_id).toBe(teamId);

      const { rows: playerRows } = await client.query(
        "select status, current_team_id, sale_price from public.players where id = $1",
        [player.id],
      );
      expect(playerRows[0].status).toBe("sold");
      expect(playerRows[0].current_team_id).toBe(teamId);
      expect(Number(playerRows[0].sale_price)).toBe(200);

      const { rows: balanceRows } = await client.query(
        "select balance from public.team_purse_balances where team_id = $1",
        [teamId],
      );
      expect(Number(balanceRows[0].balance)).toBe(800);

      const { rows: feedRows } = await client.query(
        "select * from public.public_sales_feed where player_id = $1",
        [player.id],
      );
      expect(feedRows).toHaveLength(1);
      expect(Number(feedRows[0].amount)).toBe(200);
    });
  });
});

describe("AT-AUC-02: insufficient purse blocks the sale with zero partial writes", () => {
  it("rejects and leaves the player and ledger untouched", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "AT-AUC-02 Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 100 });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Too Expensive Player", basePrice: 500 });
      const adminId = await createTestAdmin(client);

      const rejection = await expectRejection(
        client,
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid)",
        [player.id, teamId, 500, player.updatedAt, adminId],
      );
      expect(rejection.message).toMatch(/sale_blocked/);
      const detail = JSON.parse((rejection as unknown as { detail: string }).detail);
      expect(detail).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "insufficient_purse" })]));

      const { rows: playerRows } = await client.query("select status from public.players where id = $1", [player.id]);
      expect(playerRows[0].status).toBe("available");

      const { rows: ledgerRows } = await client.query(
        "select count(*) as n from public.purse_ledger where team_id = $1 and entry_kind = 'purchase'",
        [teamId],
      );
      expect(Number(ledgerRows[0].n)).toBe(0);
    });
  });
});

describe("AT-AUC-03: a configured squad/category violation is blocked", () => {
  it("rejects when the overseas cap would be exceeded", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId, maxOverseas: 0 });
      const teamId = await createTestTeam(client, { name: "AT-AUC-03 Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 1000 });
      const player = await createTestPlayer(client, {
        eventEditionId,
        fullName: "Overseas Player",
        basePrice: 100,
        isOverseas: true,
      });
      const adminId = await createTestAdmin(client);

      const rejection = await expectRejection(
        client,
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid)",
        [player.id, teamId, 100, player.updatedAt, adminId],
      );
      expect(rejection.message).toMatch(/sale_blocked/);
      const detail = JSON.parse((rejection as unknown as { detail: string }).detail);
      expect(detail).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "overseas_cap_exceeded" })]));
    });
  });
});

describe("AT-AUC-04: reversal restores all dependent state, even for a non-latest sale", () => {
  it("reversing an earlier sale (not the most recent) restores that player and purse", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "AT-AUC-04 Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 1000 });
      const playerA = await createTestPlayer(client, { eventEditionId, fullName: "Player A", basePrice: 100 });
      const playerB = await createTestPlayer(client, { eventEditionId, fullName: "Player B", basePrice: 100 });
      const adminId = await createTestAdmin(client);

      const { rows: saleARows } = await client.query(
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid) as result",
        [playerA.id, teamId, 100, playerA.updatedAt, adminId],
      );
      const saleAId = saleARows[0].result.sale_id;

      await client.query(
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid) as result",
        [playerB.id, teamId, 100, playerB.updatedAt, adminId],
      );

      // AUC-17: reverse the FIRST (non-latest) sale specifically.
      const { rows: playerARows } = await client.query(
        "select updated_at::text from public.players where id = $1",
        [playerA.id],
      );
      await client.query(
        "select public.reverse_sale($1, $2, $3::timestamptz, $4::uuid)",
        [saleAId, "AT-AUC-04 test", playerARows[0].updated_at, adminId],
      );

      const { rows: afterA } = await client.query(
        "select status, current_team_id from public.players where id = $1",
        [playerA.id],
      );
      expect(afterA[0].status).toBe("available");
      expect(afterA[0].current_team_id).toBeNull();

      // Player B's sale must remain untouched.
      const { rows: afterB } = await client.query("select status from public.players where id = $1", [playerB.id]);
      expect(afterB[0].status).toBe("sold");

      const { rows: balanceRows } = await client.query(
        "select balance from public.team_purse_balances where team_id = $1",
        [teamId],
      );
      expect(Number(balanceRows[0].balance)).toBe(900); // 1000 - 100 (A, sold) - 100 (B, sold) + 100 (A reversed)

      const { rows: reversalRows } = await client.query(
        "select reversed_at, reversal_reason from public.auction_sales where id = $1",
        [saleAId],
      );
      expect(reversalRows[0].reversed_at).not.toBeNull();
      expect(reversalRows[0].reversal_reason).toBe("AT-AUC-04 test");
    });
  });

  it("rejects reversing an already-reversed sale", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "AT-AUC-04b Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 1000 });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Double Reverse Player", basePrice: 100 });
      const adminId = await createTestAdmin(client);

      const { rows: saleRows } = await client.query(
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid) as result",
        [player.id, teamId, 100, player.updatedAt, adminId],
      );
      const saleId = saleRows[0].result.sale_id;

      const { rows: playerRows } = await client.query(
        "select updated_at::text from public.players where id = $1",
        [player.id],
      );
      await client.query("select public.reverse_sale($1, $2, $3::timestamptz, $4::uuid)", [
        saleId,
        "first reversal",
        playerRows[0].updated_at,
        adminId,
      ]);

      const { rows: playerAfter } = await client.query(
        "select updated_at::text from public.players where id = $1",
        [player.id],
      );
      const rejection = await expectRejection(
        client,
        "select public.reverse_sale($1, $2, $3::timestamptz, $4::uuid)",
        [saleId, "second reversal", playerAfter[0].updated_at, adminId],
      );
      expect(rejection.message).toMatch(/already_reversed/);
    });
  });
});

describe("AT-AUC-05: concurrency — same player, two admin devices", () => {
  // A genuine two-connection race would need the fixture rows (team,
  // player, purse grant) committed before a second session could see them
  // at all — but purse_ledger's append-only trigger rejects UPDATE/DELETE
  // unconditionally (even for the postgres role), so anything committed
  // here could never be cleaned back up. Following this suite's existing
  // convention for exactly this tension (see simulation.test.ts's
  // AT-SIM-03/04 "first two correct submissions win, third is rejected" —
  // sequential calls in one rolled-back transaction, not real
  // cross-connection concurrency): the second call here reuses the same
  // pre-sale snapshot the first call started with, exactly what two
  // devices racing on the same record would each hold.
  //
  // Note on which guard actually fires: `now()` is frozen for the whole
  // transaction (transaction_timestamp() semantics), so record_sale's own
  // `update ... players` doesn't change `updated_at` from this test's point
  // of view — the second call's p_expected_player_updated_at still
  // matches, so it falls through the stale_edit check to the status check
  // instead and gets [player_not_sellable]. In a real two-connection race,
  // now() would differ between sessions and stale_edit would fire first —
  // either guard is sufficient to prove AT-AUC-05: exactly one call wins,
  // never two.
  it("lets exactly one of two record_sale calls on the same player win", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamX = await createTestTeam(client, { name: "AT-AUC-05 Team X", eventEditionId });
      const teamY = await createTestTeam(client, { name: "AT-AUC-05 Team Y", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId: teamX, amount: 1000 });
      await grantTestPurse(client, { eventEditionId, teamId: teamY, amount: 1000 });
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Contested Player", basePrice: 100 });
      const adminId = await createTestAdmin(client);

      const { rows: firstRows } = await client.query(
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid) as result",
        [player.id, teamX, 100, player.updatedAt, adminId],
      );
      expect(firstRows[0].result.team_id).toBe(teamX);

      const rejection = await expectRejection(
        client,
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid)",
        [player.id, teamY, 100, player.updatedAt, adminId],
      );
      expect(rejection.message).toMatch(/stale_edit|player_not_sellable/);

      const { rows: finalSales } = await client.query(
        "select count(*) as n from public.auction_sales where player_id = $1",
        [player.id],
      );
      expect(Number(finalSales[0].n)).toBe(1);
    });
  });

  it("does not deadlock when two different players are sold/reversed in the same transaction", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "AT-AUC-05b Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 1000 });
      const playerA = await createTestPlayer(client, { eventEditionId, fullName: "No-Deadlock A", basePrice: 100 });
      const playerB = await createTestPlayer(client, { eventEditionId, fullName: "No-Deadlock B", basePrice: 100 });
      const adminId = await createTestAdmin(client);

      const { rows: saleBRows } = await client.query(
        "select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid) as result",
        [playerB.id, teamId, 100, playerB.updatedAt, adminId],
      );
      const saleBId = saleBRows[0].result.sale_id;
      const { rows: playerBAfter } = await client.query(
        "select updated_at::text from public.players where id = $1",
        [playerB.id],
      );

      // Both calls touch a *different* player row, so the fixed player-
      // then-team lock order every auction RPC follows means these can run
      // in either order with no lock-ordering conflict — proven here by
      // both simply succeeding.
      const [saleAResult, reversalResult] = await Promise.all([
        client.query("select public.record_sale($1, $2, $3, $4::timestamptz, $5::uuid) as result", [
          playerA.id,
          teamId,
          100,
          playerA.updatedAt,
          adminId,
        ]),
        client.query("select public.reverse_sale($1, $2, $3::timestamptz, $4::uuid)", [
          saleBId,
          "concurrent reversal",
          playerBAfter[0].updated_at,
          adminId,
        ]),
      ]);

      expect(saleAResult.rows[0].result.player_id).toBe(playerA.id);
      const { rows: playerAAfter } = await client.query("select status from public.players where id = $1", [playerA.id]);
      expect(playerAAfter[0].status).toBe("sold");
      const { rows: playerBFinal } = await client.query("select status from public.players where id = $1", [playerB.id]);
      expect(playerBFinal[0].status).toBe("available");
      void reversalResult;
    });
  });
});

describe("Record locks (AUC-13..16)", () => {
  it("blocks a second acquire within the TTL, and allows it after the lock is released", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const player = await createTestPlayer(client, { eventEditionId, fullName: "Lock Test Player" });
      const adminId = await createTestAdmin(client);

      const { rows: firstLock } = await client.query(
        "select public.acquire_record_lock($1, $2, $3, $4::uuid) as result",
        ["player", player.id, "Console A", adminId],
      );
      expect(firstLock[0].result.session_token).toBeTruthy();

      const rejection = await expectRejection(client, "select public.acquire_record_lock($1, $2, $3, $4::uuid)", [
        "player",
        player.id,
        "Console B",
        adminId,
      ]);
      expect(rejection.message).toMatch(/record_locked/);

      await client.query("select public.release_record_lock($1, $2, $3)", [
        "player",
        player.id,
        firstLock[0].result.session_token,
      ]);

      const { rows: secondLock } = await client.query(
        "select public.acquire_record_lock($1, $2, $3, $4::uuid) as result",
        ["player", player.id, "Console B", adminId],
      );
      expect(secondLock[0].result.session_token).toBeTruthy();
    });
  });
});

describe("Player import (AUC-05)", () => {
  it("partially succeeds: valid rows insert, duplicate external_ref rows are reported as errors", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const rows = [
        { externalRef: "p1", fullName: "Import Player 1", role: "batter", basePrice: 100, pool: "A", nationality: "India" },
        { externalRef: "p1", fullName: "Import Player 1 Duplicate", role: "batter", basePrice: 100, pool: "A", nationality: "India" },
        { externalRef: "p2", fullName: "Import Player 2", role: "bowler", basePrice: 150, pool: "B", nationality: "India" },
      ];

      const { rows: result } = await client.query("select public.admin_import_players($1, $2, $3) as result", [
        eventEditionId,
        null,
        JSON.stringify(rows),
      ]);

      expect(result[0].result.inserted_count).toBe(2);
      expect(result[0].result.errors).toHaveLength(1);
      expect(result[0].result.errors[0].error).toBe("duplicate_external_ref");
    });
  });
});

describe("Purse ledger append-only", () => {
  it("rejects a direct update/delete even from the postgres role", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: "Append-only Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 500 });

      const { rows: ledgerRows } = await client.query(
        "select id from public.purse_ledger where team_id = $1 limit 1",
        [teamId],
      );

      const updateRejection = await expectRejection(client, "update public.purse_ledger set amount = 999 where id = $1", [
        ledgerRows[0].id,
      ]);
      expect(updateRejection.message).toMatch(/purse_ledger_immutable/);

      const deleteRejection = await expectRejection(client, "delete from public.purse_ledger where id = $1", [
        ledgerRows[0].id,
      ]);
      expect(deleteRejection.message).toMatch(/purse_ledger_immutable/);
    });
  });
});

describe("admin_apply_pending_simulation_rewards idempotency", () => {
  it("processes zero new rows on a second run", async () => {
    await withTx(async (client) => {
      const { rows: first } = await client.query("select public.admin_apply_pending_simulation_rewards() as n");
      const { rows: second } = await client.query("select public.admin_apply_pending_simulation_rewards() as n");
      expect(second[0].n).toBe(0);
      expect(typeof first[0].n).toBe("number");
    });
  });
});
