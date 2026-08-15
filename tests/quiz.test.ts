import { describe, expect, it } from "vitest";
import { withTx, getActiveEventEditionId, createTestTeam, createTestRound } from "./helpers/db";

async function createQuizQuestion(
  client: import("pg").Client,
  roundId: string,
  eventEditionId: string,
  position: number,
  weight: number,
  correctIndex: number,
) {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.quiz_questions (round_id, event_edition_id, position, prompt, timer_seconds, weight)
     values ($1, $2, $3, $4, 60, $5) returning id`,
    [roundId, eventEditionId, position, `Question ${position}`, weight],
  );
  const questionId = rows[0]!.id;

  const optionIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const { rows: optRows } = await client.query<{ id: string }>(
      `insert into public.quiz_options (question_id, position, label, is_correct) values ($1, $2, $3, $4) returning id`,
      [questionId, i, `Option ${i}`, i === correctIndex],
    );
    optionIds.push(optRows[0]!.id);
  }
  return { questionId, optionIds };
}

describe("AT-QZ-02: weighted quiz scoring", () => {
  it("scores a correct heavily-weighted question and an incorrect one proportionally", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `QZ-02 ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `qz-02-${Date.now()}`,
        sequence: 9201,
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60 * 60_000),
      });

      const q1 = await createQuizQuestion(client, roundId, editionId, 0, 1, 0); // weight 1, correct = option 0
      const q2 = await createQuizQuestion(client, roundId, editionId, 1, 3, 0); // weight 3, correct = option 0

      const { rows: startRows } = await client.query(`select public.start_quiz_attempt($1, $2) as result`, [
        teamId,
        roundId,
      ]);
      const attemptId = startRows[0].result.attempt_id;

      // Directly insert answers rather than going through save_quiz_answer's
      // window gating (a separate concern from scoring) — team answers Q1
      // correctly, Q2 incorrectly.
      await client.query(`insert into public.quiz_answers (attempt_id, question_id, option_id) values ($1, $2, $3)`, [
        attemptId,
        q1.questionId,
        q1.optionIds[0],
      ]);
      await client.query(`insert into public.quiz_answers (attempt_id, question_id, option_id) values ($1, $2, $3)`, [
        attemptId,
        q2.questionId,
        q2.optionIds[1], // wrong
      ]);

      const { rows: submitRows } = await client.query(
        `select public.submit_quiz_attempt($1, $2, 'completed', (select session_token from public.quiz_attempts where id = $3)) as result`,
        [teamId, roundId, attemptId],
      );
      const result = submitRows[0].result;

      expect(Number(result.raw_score)).toBe(1); // only Q1 (weight 1) correct
      expect(Number(result.max_score)).toBe(4); // 1 + 3

      const { rows: scoreRows } = await client.query(
        `select total, max_total, source, published from public.scores where round_id = $1 and team_id = $2`,
        [roundId, teamId],
      );
      expect(scoreRows[0].source).toBe("quiz");
      expect(scoreRows[0].published).toBe(false); // release-gated, locked decision
      expect(Number(scoreRows[0].total)).toBe(1);
    });
  });
});

describe("AT-QZ-04: submit idempotency", () => {
  it("returns the same result on a second submit call without rescoring", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `QZ-04 ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `qz-04-${Date.now()}`,
        sequence: 9202,
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60 * 60_000),
      });
      await createQuizQuestion(client, roundId, editionId, 0, 1, 0);

      const { rows: startRows } = await client.query(`select public.start_quiz_attempt($1, $2) as result`, [
        teamId,
        roundId,
      ]);
      const token = startRows[0].result.session_token;

      const first = await client.query(
        `select public.submit_quiz_attempt($1, $2, 'completed', $3) as result`,
        [teamId, roundId, token],
      );
      const second = await client.query(
        `select public.submit_quiz_attempt($1, $2, 'fullscreen_exit', $3) as result`,
        [teamId, roundId, token],
      );

      expect(second.rows[0].result).toEqual(first.rows[0].result);

      const { rows: scoreRows } = await client.query(
        `select count(*)::int as n from public.scores where round_id = $1 and team_id = $2`,
        [roundId, teamId],
      );
      expect(scoreRows[0].n).toBe(1);
    });
  });
});

describe("AT-QZ-05: second-device concurrency block", () => {
  it("rejects a second start_quiz_attempt call for the same team/round", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `QZ-05 ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `qz-05-${Date.now()}`,
        sequence: 9203,
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60 * 60_000),
      });
      await createQuizQuestion(client, roundId, editionId, 0, 1, 0);

      await client.query(`select public.start_quiz_attempt($1, $2) as result`, [teamId, roundId]);

      await expect(client.query(`select public.start_quiz_attempt($1, $2) as result`, [teamId, roundId])).rejects.toThrow(
        /attempt_already_exists/,
      );
    });
  });
});

describe("editing a question preserves recorded answers", () => {
  /**
   * Regression test for real data loss on the live Stat Sprint round.
   *
   * admin_upsert_quiz_question()'s edit path used to `delete from
   * quiz_options` and re-insert with fresh uuids. quiz_answers.option_id
   * cascades on delete, so correcting a question's WEIGHT after the round
   * had closed destroyed every recorded answer to it — 132 answers across
   * 66 teams. Nothing surfaced it: the scores had already been computed and
   * published, and it only came to light when a recompute produced *lower*
   * scores than the originals, which a weight increase can never do.
   *
   * Fixed in 20260815090000 by upserting options on (question_id, position)
   * so ids survive. This asserts the property that actually matters: an edit
   * that doesn't remove any option must not touch quiz_answers.
   */
  it("keeps quiz_answers intact when a question's weight is corrected", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `QZ-EDIT ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `qz-edit-${Date.now()}`,
        sequence: 9401,
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60 * 60_000),
      });

      const q = await createQuizQuestion(client, roundId, editionId, 0, 0.5, 0);

      const { rows: startRows } = await client.query(`select public.start_quiz_attempt($1, $2) as result`, [
        teamId,
        roundId,
      ]);
      const attemptId = startRows[0].result.attempt_id;

      await client.query(
        `insert into public.quiz_answers (attempt_id, question_id, option_id) values ($1, $2, $3)`,
        [attemptId, q.questionId, q.optionIds[0]],
      );

      // Re-send the question unchanged except for its weight — exactly what
      // the admin quiz builder submits when fixing a weighting error.
      const options = JSON.stringify(
        [0, 1, 2, 3].map((i) => ({ label: `Option ${i}`, is_correct: i === 0 })),
      );
      await client.query(
        `select public.admin_upsert_quiz_question($1, $2, 0, 'Question 0', 60, 1.0, true, $3::jsonb)`,
        [q.questionId, roundId, options],
      );

      const { rows: answers } = await client.query(
        `select option_id from public.quiz_answers where attempt_id = $1 and question_id = $2`,
        [attemptId, q.questionId],
      );
      expect(answers).toHaveLength(1);
      // The option id itself must survive, not just the row count — that is
      // what keeps the answer pointing at the right choice.
      expect(answers[0].option_id).toBe(q.optionIds[0]);

      const { rows: weightRows } = await client.query(
        `select weight from public.quiz_questions where id = $1`,
        [q.questionId],
      );
      expect(Number(weightRows[0].weight)).toBe(1);

      // And the corrected weight is what scoring now uses.
      const { rows: submitRows } = await client.query(
        `select public.submit_quiz_attempt($1, $2, 'completed', (select session_token from public.quiz_attempts where id = $3)) as result`,
        [teamId, roundId, attemptId],
      );
      expect(Number(submitRows[0].result.raw_score)).toBe(1);
      expect(Number(submitRows[0].result.max_score)).toBe(1);
      expect(Number(submitRows[0].result.correct_count)).toBe(1);
    });
  });
});
