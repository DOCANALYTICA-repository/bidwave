import { describe, expect, it } from "vitest";
import {
  withTx,
  getActiveEventEditionId,
  createTestTeam,
  createTestAdmin,
  expectRejection,
} from "./helpers/db";

// Audit high-priority #15 — auction_rule_sets had no CHECK constraints and
// admin_save_auction_rule_set() did zero validation before insert/update.
describe("Audit #15: auction rule set validation", () => {
  it("admin_save_auction_rule_set rejects a negative starting purse with a clean error", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);

      const rejection = await expectRejection(
        client,
        `select public.admin_save_auction_rule_set(
           null, null, $1, null, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8
         )`,
        [eventEditionId, -100, 0, 15, 4, "{}", "{}", 500],
      );
      expect(rejection.message).toMatch(/invalid_rule_set/);
    });
  });

  it("admin_save_auction_rule_set rejects max_squad_size below min_squad_size", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);

      const rejection = await expectRejection(
        client,
        `select public.admin_save_auction_rule_set(
           null, null, $1, null, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8
         )`,
        [eventEditionId, 1000, 10, 5, 4, "{}", "{}", 500],
      );
      expect(rejection.message).toMatch(/invalid_rule_set/);
    });
  });

  it("a direct insert bypassing the RPC still hits the CHECK constraint", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);

      const rejection = await expectRejection(
        client,
        `insert into public.auction_rule_sets (event_edition_id, starting_purse) values ($1, $2)`,
        [eventEditionId, -1],
      );
      expect(rejection.message).toMatch(/auction_rule_sets_starting_purse_non_negative/);
    });
  });
});

// Audit high-priority #17 — leaderboard_snapshot_entries had no protection
// against a duplicate team_name within a snapshot, nor an exact-count
// guarantee for a final_top_10 publish.
describe("Audit #17: leaderboard snapshot entry integrity", () => {
  it("rejects a duplicate team_name within the same snapshot", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const { rows } = await client.query(
        `insert into public.leaderboard_snapshots (event_edition_id, kind, entry_limit)
         values ($1, 'top_15', 15) returning id`,
        [eventEditionId],
      );
      const snapshotId = rows[0].id;
      await client.query(
        `insert into public.leaderboard_snapshot_entries (snapshot_id, rank, team_name, score)
         values ($1, 1, 'Dup Team', 100)`,
        [snapshotId],
      );

      const rejection = await expectRejection(
        client,
        `insert into public.leaderboard_snapshot_entries (snapshot_id, rank, team_name, score)
         values ($1, 2, 'Dup Team', 90)`,
        [snapshotId],
      );
      expect(rejection.message).toMatch(/leaderboard_snapshot_entries_team_name_unique/);
    });
  });

  it("rejects a final_top_10 snapshot with fewer than entry_limit entries at commit", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: "FIN-COUNT Team", eventEditionId });
      const adminId = await createTestAdmin(client);

      await client.query("select public.admin_publish_leaderboard($1, 'final_top_10', $2::jsonb, 10, $3::uuid)", [
        eventEditionId,
        JSON.stringify([{ rank: 1, team_name: "Only One Team", score: 100 }]),
        adminId,
      ]);

      // The deferred constraint trigger fires at commit; withTx always
      // rolls back, so provoke it explicitly here instead.
      const rejection = await expectRejection(client, "set constraints all immediate", []);
      expect(rejection.message).toMatch(/invalid_final_top_10/);
      void teamId;
    });
  });

  it("allows a final_top_10 snapshot with exactly entry_limit entries", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const adminId = await createTestAdmin(client);
      const entries = Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1,
        team_name: `Exact Top10 Team ${i + 1}`,
        score: 100 - i,
      }));

      await client.query("select public.admin_publish_leaderboard($1, 'final_top_10', $2::jsonb, 10, $3::uuid)", [
        eventEditionId,
        JSON.stringify(entries),
        adminId,
      ]);

      // Should not raise.
      await client.query("set constraints all immediate");
    });
  });
});

// Audit high-priority #16 — player import always hardcoded
// player_stat_definitions.data_type to 'text', so numeric imports never
// powered the "undervalued player" analytics filter.
describe("Audit #16: player import infers stat data_type", () => {
  it("infers 'number' for a numeric stat value and 'text' for a string value", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const rows = [
        {
          externalRef: `stat-infer-${Date.now()}`,
          fullName: "Stat Infer Player",
          role: "batter",
          basePrice: 100,
          pool: "A",
          nationality: "India",
          stats: { strike_rate: 145.5, batting_style: "Right-hand" },
        },
      ];

      await client.query("select public.admin_import_players($1, $2, $3) as result", [
        eventEditionId,
        null,
        JSON.stringify(rows),
      ]);

      const { rows: defs } = await client.query(
        "select key, data_type from public.player_stat_definitions where event_edition_id = $1 and key in ('strike_rate', 'batting_style')",
        [eventEditionId],
      );
      const byKey = Object.fromEntries(defs.map((d: { key: string; data_type: string }) => [d.key, d.data_type]));
      expect(byKey.strike_rate).toBe("number");
      expect(byKey.batting_style).toBe("text");
    });
  });
});
