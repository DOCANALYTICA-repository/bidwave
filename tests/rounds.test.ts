import { describe, expect, it } from "vitest";
import {
  withTx,
  getActiveEventEditionId,
  createTestTeam,
  createTestRound,
  expectRejection,
  createTestAdmin,
} from "./helpers/db";

describe("submission_not_allowed / AT-RND-02: deadline enforcement", () => {
  it("rejects a submission after the round's server close time even if called directly", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `RND-02 Team ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "submission",
        slug: `rnd-02-${Date.now()}`,
        sequence: 9001,
        opensAt: new Date(Date.now() - 60_000),
        // Postgres's now() is pinned at the enclosing transaction's start
        // (withTx's `begin`), not real wall-clock time at each statement —
        // this fixture's closesAt is computed later, via Node's Date.now(),
        // after a couple of setup round-trips (edition lookup, team
        // insert) to a hosted, cross-network Postgres instance. A 1-second
        // margin isn't reliably larger than that setup latency, so the
        // computed closesAt could end up *after* the transaction-pinned
        // now() and the round would read as still open — confirmed by
        // direct reproduction. 30s is comfortably larger than any realistic
        // setup latency while still exercising "closed" enforcement.
        closesAt: new Date(Date.now() - 30_000),
      });

      const rejection = await expectRejection(client, `select public.submit_round_files($1, $2, $3::jsonb)`, [
        teamId,
        roundId,
        JSON.stringify([{ storage_path: "x", file_name: "a.pdf", mime_type: "application/pdf" }]),
      ]);
      expect(rejection.message).toMatch(/submission_not_allowed/);
    });
  });
});

describe("AT-RND-03: replace file set before close", () => {
  it("supersedes the prior file set and keeps only the latest as current", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `RND-03 Team ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "submission",
        slug: `rnd-03-${Date.now()}`,
        sequence: 9002,
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60 * 60_000),
      });

      const firstFiles = [{ storage_path: "a", file_name: "a.pdf", mime_type: "application/pdf" }];
      const secondFiles = [
        { storage_path: "b", file_name: "b.pdf", mime_type: "application/pdf" },
        { storage_path: "c", file_name: "c.pdf", mime_type: "application/pdf" },
      ];

      const first = await client.query(`select public.submit_round_files($1, $2, $3::jsonb) as id`, [
        teamId,
        roundId,
        JSON.stringify(firstFiles),
      ]);
      await client.query(`select public.submit_round_files($1, $2, $3::jsonb) as id`, [
        teamId,
        roundId,
        JSON.stringify(secondFiles),
      ]);

      const submissionId = first.rows[0].id;
      const { rows: current } = await client.query(
        `select file_name from public.submission_files where submission_id = $1 and superseded_at is null order by file_name`,
        [submissionId],
      );
      const { rows: superseded } = await client.query(
        `select file_name from public.submission_files where submission_id = $1 and superseded_at is not null`,
        [submissionId],
      );

      expect(current.map((r) => r.file_name)).toEqual(["b.pdf", "c.pdf"]);
      expect(superseded.map((r) => r.file_name)).toEqual(["a.pdf"]);
    });
  });
});

describe("AT-SCR-01: stage aggregate ranking", () => {
  it("sums weighted round totals per team and ranks correctly, including a team with a missing score", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamA = await createTestTeam(client, { name: `SCR-01 A ${Date.now()}`, eventEditionId: editionId });
      const teamB = await createTestTeam(client, { name: `SCR-01 B ${Date.now()}`, eventEditionId: editionId });
      const teamC = await createTestTeam(client, { name: `SCR-01 C ${Date.now()}`, eventEditionId: editionId });

      const roundOne = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "submission",
        slug: `scr-01-r1-${Date.now()}`,
        sequence: 9101,
      });
      const roundTwo = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "submission",
        slug: `scr-01-r2-${Date.now()}`,
        sequence: 9102,
      });

      // `code` is CHECK-constrained to the four canonical stage codes and
      // (event_edition_id, code) is unique, so reuse the seeded r1_r2 row
      // rather than inserting a duplicate — safe inside this rolled-back
      // transaction since stage_rounds/scores are scoped to the fresh
      // round/team ids created just above.
      const { rows: stageRows } = await client.query<{ id: string }>(
        `select id from public.stages where event_edition_id = $1 and code = 'r1_r2'`,
        [editionId],
      );
      const stageId = stageRows[0]!.id;

      await client.query(
        `insert into public.stage_rounds (stage_id, round_id, weight) values ($1, $2, 1), ($1, $3, 1)`,
        [stageId, roundOne, roundTwo],
      );

      // Team A: 80 + 80 = 160. Team B: 100 + 0 (no score for round two — must
      // still be ranked, not excluded). Team C: no scores at all.
      await client.query(
        `insert into public.scores (round_id, team_id, total) values ($1, $2, 80), ($1, $3, 100), ($4, $2, 80)`,
        [roundOne, teamA, teamB, roundTwo],
      );

      const { rows: standings } = await client.query(
        `select team_id, aggregate, rank from public.stage_standings($1) order by rank`,
        [stageId],
      );

      expect(standings).toHaveLength(3);
      const byTeam = new Map(standings.map((s) => [s.team_id, s]));
      expect(Number(byTeam.get(teamA)!.aggregate)).toBe(160);
      expect(Number(byTeam.get(teamB)!.aggregate)).toBe(100);
      expect(Number(byTeam.get(teamC)!.aggregate)).toBe(0);
      expect(Number(byTeam.get(teamA)!.rank)).toBe(1);
      expect(Number(byTeam.get(teamB)!.rank)).toBe(2);
      expect(Number(byTeam.get(teamC)!.rank)).toBe(3);
    });
  });
});

describe("AT-LDB-01: entering scores never moves the public leaderboard until published", () => {
  it("has no live snapshot before publish, and a live snapshot with the right entries after", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const kind = "top_15";

      const before = await client.query(
        `select id from public.leaderboard_snapshots where event_edition_id = $1 and kind = $2 and hidden_at is null`,
        [editionId, kind],
      );
      // Whatever the state before this test (another snapshot may already
      // be live from other work), the point is that publishing changes it —
      // capture the current live id, if any, to compare against.
      const beforeId = before.rows[0]?.id ?? null;

      const entries = [{ rank: 1, team_name: "LDB-01 Test Team", score: 42 }];
      const adminId = await createTestAdmin(client);
      await client.query(`select public.admin_publish_leaderboard($1, $2, $3::jsonb, $4, $5::uuid) as id`, [
        editionId,
        kind,
        JSON.stringify(entries),
        15,
        adminId,
      ]);

      const { rows: liveNow } = await client.query(
        `select s.id, e.team_name, e.score
         from public.leaderboard_snapshots s
         join public.leaderboard_snapshot_entries e on e.snapshot_id = s.id
         where s.event_edition_id = $1 and s.kind = $2 and s.hidden_at is null`,
        [editionId, kind],
      );

      expect(liveNow[0].id).not.toBe(beforeId);
      expect(liveNow.some((r) => r.team_name === "LDB-01 Test Team" && Number(r.score) === 42)).toBe(true);
    });
  });
});
