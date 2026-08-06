import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  withTx,
  getActiveEventEditionId,
  createTestTeam,
  createTestRound,
  asRole,
} from "./helpers/db";

// Audit high-priority #11 — start_scoring let scoring begin once closes_at
// merely elapsed, without stamping closed_at, but release_publicly
// requires closed_at is not null — a clock-auto-closed round could get
// permanently stuck unable to publish.
describe("Audit #11: a clock-auto-closed round can still reach release_publicly", () => {
  it("start_scoring backfills closed_at so release_publicly is not stuck", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const roundId = await createTestRound(client, {
        eventEditionId,
        kind: "submission",
        slug: "workflow-test-round",
        sequence: 101,
        opensAt: new Date(Date.now() - 60 * 60 * 1000),
        closesAt: new Date(Date.now() - 1000), // already elapsed, never manually closed
      });

      const { rows: before } = await client.query("select closed_at from public.rounds where id = $1", [roundId]);
      expect(before[0].closed_at).toBeNull();

      await client.query("select public.admin_set_round_lifecycle($1, 'start_scoring')", [roundId]);

      const { rows: afterScoring } = await client.query(
        "select closed_at, scoring_started_at from public.rounds where id = $1",
        [roundId],
      );
      expect(afterScoring[0].closed_at).not.toBeNull();
      expect(afterScoring[0].scoring_started_at).not.toBeNull();

      await client.query("select public.admin_set_round_lifecycle($1, 'mark_scored')", [roundId]);
      // Previously impossible: release_publicly requires closed_at is not
      // null, which start_scoring now guarantees even for a clock-only close.
      await client.query("select public.admin_set_round_lifecycle($1, 'release_publicly')", [roundId]);

      const { rows: final } = await client.query(
        "select public_released_at from public.rounds where id = $1",
        [roundId],
      );
      expect(final[0].public_released_at).not.toBeNull();
    });
  });

  it("a manually closed round keeps its real closed_at, not the scoring-start time", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const roundId = await createTestRound(client, {
        eventEditionId,
        kind: "submission",
        slug: "workflow-test-round-manual",
        sequence: 102,
        opensAt: new Date(Date.now() - 60 * 60 * 1000),
        closesAt: new Date(Date.now() + 60 * 60 * 1000), // not yet elapsed
      });

      await client.query("select public.admin_set_round_lifecycle($1, 'close_now')", [roundId]);
      const { rows: afterClose } = await client.query("select closed_at from public.rounds where id = $1", [roundId]);
      const realClosedAt = afterClose[0].closed_at;
      expect(realClosedAt).not.toBeNull();

      await client.query("select public.admin_set_round_lifecycle($1, 'start_scoring')", [roundId]);
      const { rows: afterScoring } = await client.query("select closed_at from public.rounds where id = $1", [roundId]);
      expect(afterScoring[0].closed_at.getTime()).toBe(realClosedAt.getTime());
    });
  });
});

// Audit high-priority #6 — "no submission download after close" was a
// blocklist (effective_round_status <> 'closed'), which unintentionally
// reopened access once the round moved past 'closed' into scoring/scored/
// publicly_released/archived.
describe("Audit #6: submission file visibility is an allowlist, not a blocklist", () => {
  async function submissionForRoundInStatus(
    client: Client,
    eventEditionId: string,
    roundStatus: "open" | "closed" | "scoring" | "scored" | "publicly_released",
  ) {
    const now = Date.now();
    const roundId = await createTestRound(client, {
      eventEditionId,
      kind: "submission",
      slug: `visibility-test-${roundStatus}-${now}`,
      sequence: 200 + Math.floor(Math.random() * 1000),
      opensAt: new Date(now - 60 * 60 * 1000),
      closesAt: roundStatus === "open" ? new Date(now + 60 * 60 * 1000) : new Date(now - 60 * 60 * 1000),
    });

    if (roundStatus === "scoring" || roundStatus === "scored" || roundStatus === "publicly_released") {
      await client.query("select public.admin_set_round_lifecycle($1, 'start_scoring')", [roundId]);
    }
    if (roundStatus === "scored" || roundStatus === "publicly_released") {
      await client.query("select public.admin_set_round_lifecycle($1, 'mark_scored')", [roundId]);
    }
    if (roundStatus === "publicly_released") {
      await client.query("select public.admin_set_round_lifecycle($1, 'release_publicly')", [roundId]);
    }

    const teamId = await createTestTeam(client, { name: `Visibility Team ${roundStatus} ${now}`, eventEditionId });
    const { rows: subRows } = await client.query(
      `insert into public.submissions (round_id, team_id, submitted_at) values ($1, $2, now()) returning id`,
      [roundId, teamId],
    );
    const submissionId = subRows[0].id;
    await client.query(
      `insert into public.submission_files (submission_id, storage_path, file_name, mime_type)
       values ($1, $2, 'brief.pdf', 'application/pdf')`,
      [submissionId, `${teamId}/${roundId}/brief.pdf`],
    );

    return teamId;
  }

  it("a team sees its submission file while the round is open", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const teamId = await submissionForRoundInStatus(client, eventEditionId, "open");

      await asRole(client, "authenticated", { sub: teamId, app_metadata: {} });
      const { rows } = await client.query("select id from public.submission_files");
      expect(rows).toHaveLength(1);
    });
  });

  for (const status of ["closed", "scoring", "scored", "publicly_released"] as const) {
    it(`a team cannot see its submission file once the round is ${status}`, async () => {
      await withTx(async (client) => {
        const eventEditionId = await getActiveEventEditionId(client);
        const teamId = await submissionForRoundInStatus(client, eventEditionId, status);

        await asRole(client, "authenticated", { sub: teamId, app_metadata: {} });
        const { rows } = await client.query("select id from public.submission_files");
        expect(rows).toHaveLength(0);
      });
    });
  }
});

// Audit high-priority #5 — admin material uploads used to write to the
// submissions bucket at a path no team's storage policy could ever match.
// round-materials is a dedicated bucket whose object-level SELECT policy
// mirrors round_materials_select_authenticated/public_released.
describe("Audit #5: round-materials storage bucket policies", () => {
  it("a registered team can read a round's material object", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const roundId = await createTestRound(client, {
        eventEditionId,
        kind: "submission",
        slug: `materials-bucket-test-${Date.now()}`,
        sequence: 300 + Math.floor(Math.random() * 1000),
      });
      const teamId = await createTestTeam(client, { name: "Materials Bucket Team", eventEditionId });
      const path = `${roundId}/brief.pdf`;
      await client.query(
        `insert into public.round_materials (round_id, kind, title, storage_path) values ($1, 'file', 'Brief', $2)`,
        [roundId, path],
      );
      await client.query(`insert into storage.objects (bucket_id, name) values ('round-materials', $1)`, [path]);

      await asRole(client, "authenticated", { sub: teamId, app_metadata: {} });
      const { rows } = await client.query("select name from storage.objects where bucket_id = 'round-materials' and name = $1", [path]);
      expect(rows).toHaveLength(1);
    });
  });

  it("anon cannot read a material object for a round that has not been publicly released", async () => {
    await withTx(async (client) => {
      const eventEditionId = await getActiveEventEditionId(client);
      const roundId = await createTestRound(client, {
        eventEditionId,
        kind: "submission",
        slug: `materials-bucket-locked-${Date.now()}`,
        sequence: 400 + Math.floor(Math.random() * 1000),
      });
      const path = `${roundId}/locked.pdf`;
      await client.query(
        `insert into public.round_materials (round_id, kind, title, storage_path, public_release) values ($1, 'file', 'Locked', $2, false)`,
        [roundId, path],
      );
      await client.query(`insert into storage.objects (bucket_id, name) values ('round-materials', $1)`, [path]);

      await asRole(client, "anon");
      const { rows } = await client.query("select name from storage.objects where bucket_id = 'round-materials' and name = $1", [path]);
      expect(rows).toHaveLength(0);
    });
  });
});
