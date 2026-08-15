import { describe, expect, it } from "vitest";
import { createTestTeam, expectRejection, getActiveEventEditionId, withTx } from "./helpers/db";

/**
 * submit_round_files() with shared-link entries (migration 20260815110000).
 *
 * Runs against the real database inside a rolled-back transaction: the
 * object-xor-link constraint and supersede-on-replace are the behaviour
 * under test, and neither exists anywhere but in Postgres.
 */
describe("submit_round_files with shared links", () => {
  async function openRound(client: Parameters<typeof createTestTeam>[0], eventEditionId: string) {
    const { rows } = await client.query(
      `insert into public.rounds (event_edition_id, kind, sequence, slug, title, opens_at, closes_at)
       values ($1, 'submission', 98, 'link-round', 'Link Round',
               now() - interval '1 hour', now() + interval '1 hour')
       returning id`,
      [eventEditionId],
    );
    return rows[0].id as string;
  }

  it("records a link entry alongside an uploaded one", async () => {
    await withTx(async (db) => {
      const eventEditionId = await getActiveEventEditionId(db);
      const roundId = await openRound(db, eventEditionId);
      const teamId = await createTestTeam(db, { name: "Link Team", eventEditionId });

      await db.query(`select public.submit_round_files($1, $2, $3::jsonb)`, [
        teamId,
        roundId,
        JSON.stringify([
          { external_url: "https://drive.google.com/file/d/a/view", file_name: "drive.google.com" },
          {
            storage_path: `${teamId}/${roundId}/x.pdf`,
            file_name: "deck.pdf",
            mime_type: "application/pdf",
          },
        ]),
      ]);

      const { rows } = await db.query(
        `select f.storage_path, f.external_url, f.mime_type
         from public.submission_files f
         join public.submissions s on s.id = f.submission_id
         where s.team_id = $1 and f.superseded_at is null
         order by f.external_url nulls last`,
        [teamId],
      );

      expect(rows).toHaveLength(2);
      // The link row: URL set, no object, no MIME.
      expect(rows[0].external_url).toBe("https://drive.google.com/file/d/a/view");
      expect(rows[0].storage_path).toBeNull();
      expect(rows[0].mime_type).toBeNull();
      // The uploaded row is untouched by any of this.
      expect(rows[1].storage_path).toBe(`${teamId}/${roundId}/x.pdf`);
      expect(rows[1].external_url).toBeNull();
      expect(rows[1].mime_type).toBe("application/pdf");
    });
  });

  it("supersedes links on replacement, same as files (SUB-02/03)", async () => {
    await withTx(async (db) => {
      const eventEditionId = await getActiveEventEditionId(db);
      const roundId = await openRound(db, eventEditionId);
      const teamId = await createTestTeam(db, { name: "Replace Team", eventEditionId });

      await db.query(`select public.submit_round_files($1, $2, $3::jsonb)`, [
        teamId,
        roundId,
        JSON.stringify([
          { external_url: "https://drive.google.com/file/d/a/view", file_name: "drive.google.com" },
        ]),
      ]);
      await db.query(`select public.submit_round_files($1, $2, $3::jsonb)`, [
        teamId,
        roundId,
        JSON.stringify([{ external_url: "https://youtu.be/b", file_name: "youtu.be" }]),
      ]);

      const { rows } = await db.query(
        `select count(*) filter (where f.superseded_at is null) as live, count(*) as total
         from public.submission_files f
         join public.submissions s on s.id = f.submission_id
         where s.team_id = $1`,
        [teamId],
      );
      expect(Number(rows[0].live)).toBe(1);
      expect(Number(rows[0].total)).toBe(2);
    });
  });

  it("rejects an entry that is neither an uploaded object nor a link", async () => {
    await withTx(async (db) => {
      const eventEditionId = await getActiveEventEditionId(db);
      const roundId = await openRound(db, eventEditionId);
      const teamId = await createTestTeam(db, { name: "Bad Entry Team", eventEditionId });

      const err = await expectRejection(db, `select public.submit_round_files($1, $2, $3::jsonb)`, [
        teamId,
        roundId,
        JSON.stringify([{ file_name: "nothing.pdf" }]),
      ]);
      expect(err.message).toMatch(/object_xor_link/);
    });
  });

  it("rejects an entry claiming to be both", async () => {
    await withTx(async (db) => {
      const eventEditionId = await getActiveEventEditionId(db);
      const roundId = await openRound(db, eventEditionId);
      const teamId = await createTestTeam(db, { name: "Both Team", eventEditionId });

      const err = await expectRejection(db, `select public.submit_round_files($1, $2, $3::jsonb)`, [
        teamId,
        roundId,
        JSON.stringify([
          {
            storage_path: `${teamId}/${roundId}/x.pdf`,
            file_name: "x.pdf",
            mime_type: "application/pdf",
            external_url: "https://drive.google.com/file/d/a/view",
          },
        ]),
      ]);
      expect(err.message).toMatch(/object_xor_link/);
    });
  });
});
