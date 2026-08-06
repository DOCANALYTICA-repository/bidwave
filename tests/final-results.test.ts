import { describe, expect, it } from "vitest";
import { withTx, getActiveEventEditionId, createTestTeam, createTestRound, createTestAdmin } from "./helpers/db";

describe("AT-FIN-01: Round 6 scoring is standalone, never auto-combined with final", () => {
  it("moves the r6 stage's aggregate without moving the final stage's aggregate", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamA = await createTestTeam(client, { name: `FIN-01 A ${Date.now()}`, eventEditionId: editionId });

      const conferenceRound = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "conference",
        slug: `fin-01-r6-${Date.now()}`,
        sequence: 9201,
      });

      const { rows: stageRows } = await client.query<{ code: string; id: string }>(
        `select id, code from public.stages where event_edition_id = $1 and code in ('r6', 'final')`,
        [editionId],
      );
      const r6StageId = stageRows.find((s) => s.code === "r6")!.id;
      const finalStageId = stageRows.find((s) => s.code === "final")!.id;

      // Capture final's aggregate for teamA before wiring the conference
      // round into r6 — this is the baseline "unaffected" must hold against.
      const beforeFinal = await client.query(
        `select coalesce((select aggregate from public.stage_standings($1) where team_id = $2), 0) as aggregate`,
        [finalStageId, teamA],
      );

      await client.query(
        `insert into public.stage_rounds (stage_id, round_id, weight) values ($1, $2, 1)`,
        [r6StageId, conferenceRound],
      );
      await client.query(
        `insert into public.scores (round_id, team_id, total) values ($1, $2, 87)`,
        [conferenceRound, teamA],
      );

      const { rows: r6Standings } = await client.query(
        `select aggregate from public.stage_standings($1) where team_id = $2`,
        [r6StageId, teamA],
      );
      expect(Number(r6Standings[0].aggregate)).toBe(87);

      const afterFinal = await client.query(
        `select coalesce((select aggregate from public.stage_standings($1) where team_id = $2), 0) as aggregate`,
        [finalStageId, teamA],
      );
      expect(Number(afterFinal.rows[0].aggregate)).toBe(Number(beforeFinal.rows[0].aggregate));
    });
  });
});

describe("Final Top 10 publish is an explicit array, never a computed formula", () => {
  it("publishes exactly the array passed in, regardless of what stage_standings would compute", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamA = await createTestTeam(client, { name: `FIN-PUB A ${Date.now()}`, eventEditionId: editionId });
      const teamB = await createTestTeam(client, { name: `FIN-PUB B ${Date.now()}`, eventEditionId: editionId });

      const { rows: teamNames } = await client.query<{ name: string }>(
        "select name from public.teams where id = any($1)",
        [[teamA, teamB]],
      );

      // Deliberately reversed order and arbitrary scores that don't match
      // any stage aggregate — proves admin_publish_leaderboard() never
      // recomputes or reorders, it only stores what it's given.
      const entries = [
        { rank: 1, team_name: teamNames.find((t) => t.name.startsWith("FIN-PUB B"))!.name, score: 999 },
        { rank: 2, team_name: teamNames.find((t) => t.name.startsWith("FIN-PUB A"))!.name, score: 1 },
      ];

      const adminId = await createTestAdmin(client);
      await client.query(`select public.admin_publish_leaderboard($1, 'final_top_10', $2::jsonb, 10, $3::uuid)`, [
        editionId,
        JSON.stringify(entries),
        adminId,
      ]);

      const { rows: live } = await client.query(
        `select e.rank, e.team_name, e.score
         from public.leaderboard_snapshots s
         join public.leaderboard_snapshot_entries e on e.snapshot_id = s.id
         where s.event_edition_id = $1 and s.kind = 'final_top_10' and s.hidden_at is null
         order by e.rank`,
        [editionId],
      );

      expect(live).toHaveLength(2);
      expect(live[0].team_name).toBe(entries[0].team_name);
      expect(Number(live[0].score)).toBe(999);
      expect(live[1].team_name).toBe(entries[1].team_name);
      expect(Number(live[1].score)).toBe(1);
    });
  });
});

describe("SEC-10: rate limiting rejects excess quiz-submit and simulation-attempt calls", () => {
  it("check_rate_limit() returns false once max_count is exceeded within the window", async () => {
    await withTx(async (client) => {
      const key = `test-team-${Date.now()}`;

      for (let i = 0; i < 3; i++) {
        const { rows } = await client.query(
          "select public.check_rate_limit($1, $2, $3, $4) as ok",
          ["quiz_submit", key, 3, 60],
        );
        expect(rows[0].ok).toBe(true);
      }

      const { rows: exceeded } = await client.query(
        "select public.check_rate_limit($1, $2, $3, $4) as ok",
        ["quiz_submit", key, 3, 60],
      );
      expect(exceeded[0].ok).toBe(false);
    });
  });

  it("uses an independent bucket for simulation_attempt", async () => {
    await withTx(async (client) => {
      const key = `test-team-${Date.now()}`;

      for (let i = 0; i < 3; i++) {
        const { rows } = await client.query(
          "select public.check_rate_limit($1, $2, $3, $4) as ok",
          ["simulation_attempt", key, 3, 60],
        );
        expect(rows[0].ok).toBe(true);
      }

      const { rows: exceeded } = await client.query(
        "select public.check_rate_limit($1, $2, $3, $4) as ok",
        ["simulation_attempt", key, 3, 60],
      );
      expect(exceeded[0].ok).toBe(false);

      // A different bucket for the same key is unaffected — proves buckets
      // are genuinely independent, not a single global counter per key.
      const { rows: otherBucket } = await client.query(
        "select public.check_rate_limit($1, $2, $3, $4) as ok",
        ["quiz_submit", key, 3, 60],
      );
      expect(otherBucket[0].ok).toBe(true);
    });
  });
});
