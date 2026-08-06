import { describe, expect, it } from "vitest";
import {
  withTx,
  getActiveEventEditionId,
  createTestTeam,
  createTestAuctionRuleSet,
  grantTestPurse,
  createTestAnalyticsRequest,
  expectRejection,
  createTestAdmin,
} from "./helpers/db";

describe("AN-03: request_analytics blocks an under-funded team", () => {
  it("rejects and inserts nothing", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      // analytics_price defaults to auction_rule_sets' own column default (500);
      // createTestAuctionRuleSet doesn't set it, so it's 500 — grant less than that.
      const teamId = await createTestTeam(client, { name: "AN-03 Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 100 });

      const rejection = await expectRejection(client, "select public.request_analytics($1)", [teamId]);
      expect(rejection.message).toMatch(/insufficient_purse/);

      const { rows } = await client.query(
        "select count(*) as n from public.analytics_requests where team_id = $1",
        [teamId],
      );
      expect(Number(rows[0].n)).toBe(0);
    });
  });
});

describe("AN-06: repeat request while pending/approved is idempotent", () => {
  it("returns the existing row instead of erroring or inserting a second one", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "AN-06 Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 10000 });

      const first = await client.query("select public.request_analytics($1) as result", [teamId]);
      const requestId = first.rows[0].result.request_id;

      const second = await client.query("select public.request_analytics($1) as result", [teamId]);
      expect(second.rows[0].result.request_id).toBe(requestId);
      expect(second.rows[0].result.status).toBe("pending");

      const { rows } = await client.query(
        "select count(*) as n from public.analytics_requests where team_id = $1",
        [teamId],
      );
      expect(Number(rows[0].n)).toBe(1);
    });
  });
});

describe("Re-request after rejection succeeds (no cooldown)", () => {
  it("allows a fresh pending row once the prior one is rejected", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "Re-request Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 10000 });

      const requestId = await createTestAnalyticsRequest(client, { eventEditionId, teamId, status: "pending" });
      const adminId = await createTestAdmin(client);
      await client.query("select public.reject_analytics($1, $2, $3::uuid)", [requestId, "not shortlisted", adminId]);

      const { rows } = await client.query("select public.request_analytics($1) as result", [teamId]);
      expect(rows[0].result.request_id).not.toBe(requestId);
      expect(rows[0].result.status).toBe("pending");
    });
  });
});

describe("Reject never touches the ledger", () => {
  it("leaves purse_ledger untouched for the team", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: "Reject Team", eventEditionId });
      const requestId = await createTestAnalyticsRequest(client, { eventEditionId, teamId, status: "pending" });
      const adminId = await createTestAdmin(client);

      await client.query("select public.reject_analytics($1, $2, $3::uuid)", [
        requestId,
        "insufficient qualification",
        adminId,
      ]);

      const { rows } = await client.query(
        "select count(*) as n from public.purse_ledger where team_id = $1 and entry_kind = 'analytics'",
        [teamId],
      );
      expect(Number(rows[0].n)).toBe(0);

      const { rows: reqRows } = await client.query(
        "select status, rejection_reason from public.analytics_requests where id = $1",
        [requestId],
      );
      expect(reqRows[0].status).toBe("rejected");
      expect(reqRows[0].rejection_reason).toBe("insufficient qualification");
    });
  });
});

describe("reject_analytics requires a non-empty reason", () => {
  it("rejects an empty/whitespace-only reason", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: "Reason Team", eventEditionId });
      const requestId = await createTestAnalyticsRequest(client, { eventEditionId, teamId, status: "pending" });
      const adminId = await createTestAdmin(client);

      const rejection = await expectRejection(client, "select public.reject_analytics($1, $2, $3::uuid)", [
        requestId,
        "   ",
        adminId,
      ]);
      expect(rejection.message).toMatch(/reason_required/);
    });
  });
});

describe("AT-AN-01/02: approve_analytics deducts once, unlocks once", () => {
  it("the second approval on an already-decided request is rejected", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "AT-AN-01 Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 10000 });
      const requestId = await createTestAnalyticsRequest(client, {
        eventEditionId,
        teamId,
        status: "pending",
        priceAtRequest: 500,
      });

      const adminId = await createTestAdmin(client);
      const { rows } = await client.query("select public.approve_analytics($1, $2::uuid) as result", [
        requestId,
        adminId,
      ]);
      expect(rows[0].result.team_id).toBe(teamId);
      expect(Number(rows[0].result.price_charged)).toBe(500);

      const rejection = await expectRejection(client, "select public.approve_analytics($1, $2::uuid)", [
        requestId,
        adminId,
      ]);
      expect(rejection.message).toMatch(/already_decided/);

      const { rows: ledgerRows } = await client.query(
        "select amount from public.purse_ledger where team_id = $1 and entry_kind = 'analytics'",
        [teamId],
      );
      expect(ledgerRows).toHaveLength(1);
      expect(Number(ledgerRows[0].amount)).toBe(-500);

      const { rows: reqRows } = await client.query(
        "select status, purse_ledger_entry_id from public.analytics_requests where id = $1",
        [requestId],
      );
      expect(reqRows[0].status).toBe("approved");
      expect(reqRows[0].purse_ledger_entry_id).not.toBeNull();
    });
  });
});

describe("ERR-10: approval fails cleanly if the purse drops below price meanwhile", () => {
  it("leaves the request pending and writes zero ledger rows", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "ERR-10 Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 500 });
      const requestId = await createTestAnalyticsRequest(client, {
        eventEditionId,
        teamId,
        status: "pending",
        priceAtRequest: 500,
      });

      // Purse drops below price after the request was made, before approval.
      await client.query(
        `insert into public.purse_ledger (event_edition_id, team_id, entry_kind, amount)
         values ($1, $2, 'adjustment', -400)`,
        [eventEditionId, teamId],
      );

      const adminId = await createTestAdmin(client);
      const rejection = await expectRejection(client, "select public.approve_analytics($1, $2::uuid)", [
        requestId,
        adminId,
      ]);
      expect(rejection.message).toMatch(/insufficient_purse/);

      const { rows: reqRows } = await client.query(
        "select status from public.analytics_requests where id = $1",
        [requestId],
      );
      expect(reqRows[0].status).toBe("pending");

      const { rows: ledgerRows } = await client.query(
        "select count(*) as n from public.purse_ledger where team_id = $1 and entry_kind = 'analytics'",
        [teamId],
      );
      expect(Number(ledgerRows[0].n)).toBe(0);
    });
  });
});

describe("AT-AN-03: public_analytics_status never exposes more than locked/purchased", () => {
  it("collapses pending and rejected to locked, approved to purchased", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      await createTestAuctionRuleSet(client, { eventEditionId });
      const teamId = await createTestTeam(client, { name: "Public View Team", eventEditionId });
      await grantTestPurse(client, { eventEditionId, teamId, amount: 10000 });

      const pendingStatus = async () => {
        const { rows } = await client.query(
          "select status from public.public_analytics_status where team_id = $1",
          [teamId],
        );
        return rows[0].status as string;
      };

      expect(await pendingStatus()).toBe("locked");

      const requestId = await createTestAnalyticsRequest(client, { eventEditionId, teamId, status: "pending" });
      expect(await pendingStatus()).toBe("locked");

      const adminId = await createTestAdmin(client);
      await client.query("select public.approve_analytics($1, $2::uuid)", [requestId, adminId]);
      expect(await pendingStatus()).toBe("purchased");
    });
  });
});

describe("Grant hygiene: analytics RPCs are service_role-only", () => {
  it("grants EXECUTE only to service_role, never anon/authenticated", async () => {
    await withTx(async (client) => {
      const { rows } = await client.query(`
        select routine_name, grantee
        from information_schema.role_routine_grants
        where routine_schema = 'public'
          and routine_name in ('request_analytics', 'approve_analytics', 'reject_analytics')
          and grantee in ('anon', 'authenticated')
      `);
      expect(rows).toHaveLength(0);
    });
  });
});
