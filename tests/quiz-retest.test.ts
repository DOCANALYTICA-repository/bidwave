import { describe, expect, it } from "vitest";
import { withTx, getActiveEventEditionId, createTestTeam, createTestRound, expectRejection } from "./helpers/db";

/**
 * Migration 20260814050000 — the Round 1 re-attempt round and the
 * participant score-display fix.
 *
 * The first suite here is the important one: it proves the migration is
 * Round-1-neutral. Every new rounds column defaults to the pre-migration
 * behaviour, and if that ever stops being true, attempts already recorded
 * under the original rules would start being governed by different ones.
 */

async function createQuizQuestion(
  client: import("pg").Client,
  roundId: string,
  eventEditionId: string,
  position: number,
  weight: number,
  correctIndex: number,
  timerSeconds = 60,
) {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.quiz_questions (round_id, event_edition_id, position, prompt, timer_seconds, weight)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [roundId, eventEditionId, position, `Question ${position}`, timerSeconds, weight],
  );
  const questionId = rows[0]!.id;
  const optionIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const { rows: optRows } = await client.query<{ id: string }>(
      `insert into public.quiz_options (question_id, position, label, is_correct)
       values ($1, $2, $3, $4) returning id`,
      [questionId, i, `Option ${i}`, i === correctIndex],
    );
    optionIds.push(optRows[0]!.id);
  }
  return { questionId, optionIds };
}

async function startAttempt(client: import("pg").Client, teamId: string, roundId: string) {
  const { rows } = await client.query(`select public.start_quiz_attempt($1, $2) as result`, [teamId, roundId]);
  return rows[0].result as { attempt_id: string; session_token: string };
}

async function answer(
  client: import("pg").Client,
  attemptId: string,
  questionId: string,
  optionId: string,
) {
  await client.query(
    `insert into public.quiz_answers (attempt_id, question_id, option_id) values ($1, $2, $3)`,
    [attemptId, questionId, optionId],
  );
}

const OPEN = { opensAt: new Date(Date.now() - 60_000), closesAt: new Date(Date.now() + 60 * 60_000) };

describe("migration neutrality: existing rounds behave exactly as before", () => {
  it("defaults a plain round to strict/non-invite, submits on the first strike, and refuses resume", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `RT-N ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-neutral-${Date.now()}`,
        sequence: 9301,
        ...OPEN,
      });

      const { rows: cols } = await client.query(
        `select is_invite_only, quiz_exit_policy, quiz_strike_limit, supersedes_round_id
         from public.rounds where id = $1`,
        [roundId],
      );
      expect(cols[0]).toMatchObject({
        is_invite_only: false,
        quiz_exit_policy: "strict",
        quiz_strike_limit: 1,
        supersedes_round_id: null,
      });

      const q = await createQuizQuestion(client, roundId, editionId, 0, 1, 0);

      // No allowlist rows exist, yet a non-invite-only round is open to all.
      const { rows: canRows } = await client.query(`select public.can_team_submit($1, $2) as ok`, [
        roundId,
        teamId,
      ]);
      expect(canRows[0].ok).toBe(true);

      const attempt = await startAttempt(client, teamId, roundId);
      await answer(client, attempt.attempt_id, q.questionId, q.optionIds[0]!);

      // Strict: the FIRST exit signal ends the attempt, no warning.
      const { rows: strikeRows } = await client.query(
        `select public.record_quiz_strike($1, $2, $3, 'visibility_hidden') as result`,
        [teamId, roundId, attempt.session_token],
      );
      expect(strikeRows[0].result.status).toBe("submitted");
      expect(strikeRows[0].result.ended_by_strike).toBe(true);

      const { rows: after } = await client.query(
        `select status, submit_reason, strike_count from public.quiz_attempts where id = $1`,
        [attempt.attempt_id],
      );
      expect(after[0]).toMatchObject({
        status: "submitted",
        submit_reason: "visibility_hidden",
        strike_count: 1,
      });

      const err = await expectRejection(client, `select public.resume_quiz_attempt($1, $2)`, [teamId, roundId]);
      expect(err.message).toContain("[resume_not_allowed]");
    });
  });
});

describe("invite-only eligibility", () => {
  it("refuses a team that is not on the allowlist and admits it once added", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `RT-E ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-elig-${Date.now()}`,
        sequence: 9302,
        isInviteOnly: true,
        quizExitPolicy: "lenient",
        quizStrikeLimit: 2,
        ...OPEN,
      });
      await createQuizQuestion(client, roundId, editionId, 0, 1, 0);

      const { rows: before } = await client.query(`select public.can_team_submit($1, $2) as ok`, [
        roundId,
        teamId,
      ]);
      expect(before[0].ok).toBe(false);

      const err = await expectRejection(client, `select public.start_quiz_attempt($1, $2)`, [teamId, roundId]);
      expect(err.message).toContain("[not_eligible]");

      await client.query(`select public.admin_add_round_eligible_team($1, $2, null, null)`, [roundId, teamId]);

      const { rows: after } = await client.query(`select public.can_team_submit($1, $2) as ok`, [
        roundId,
        teamId,
      ]);
      expect(after[0].ok).toBe(true);

      const attempt = await startAttempt(client, teamId, roundId);
      expect(attempt.attempt_id).toBeTruthy();
    });
  });

  it("refuses to remove a team that already has an attempt", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `RT-L ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-lock-${Date.now()}`,
        sequence: 9303,
        isInviteOnly: true,
        quizExitPolicy: "lenient",
        quizStrikeLimit: 2,
        ...OPEN,
      });
      await createQuizQuestion(client, roundId, editionId, 0, 1, 0);
      await client.query(`select public.admin_add_round_eligible_team($1, $2, null, null)`, [roundId, teamId]);
      await startAttempt(client, teamId, roundId);

      const err = await expectRejection(client, `select public.admin_remove_round_eligible_team($1, $2, null)`, [
        roundId,
        teamId,
      ]);
      expect(err.message).toContain("[eligibility_locked]");

      // The bulk setter guards the same way: omitting the team is a removal.
      const bulkErr = await expectRejection(
        client,
        `select public.admin_set_round_eligibility($1, '{}'::uuid[], null, null)`,
        [roundId],
      );
      expect(bulkErr.message).toContain("[eligibility_locked]");
    });
  });

  it("replaces the whole list for teams without attempts", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const a = await createTestTeam(client, { name: `RT-S A ${Date.now()}`, eventEditionId: editionId });
      const b = await createTestTeam(client, { name: `RT-S B ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-set-${Date.now()}`,
        sequence: 9304,
        isInviteOnly: true,
        ...OPEN,
      });

      const { rows: first } = await client.query(
        `select public.admin_set_round_eligibility($1, array[$2::uuid], null, null) as n`,
        [roundId, a],
      );
      expect(Number(first[0].n)).toBe(1);

      const { rows: second } = await client.query(
        `select public.admin_set_round_eligibility($1, array[$2::uuid], null, null) as n`,
        [roundId, b],
      );
      expect(Number(second[0].n)).toBe(1);

      const { rows: who } = await client.query(
        `select team_id from public.round_eligible_teams where round_id = $1`,
        [roundId],
      );
      expect(who.map((r) => r.team_id)).toEqual([b]);
    });
  });
});

describe("lenient exit policy: warn once, then submit", () => {
  async function lenientRound(client: import("pg").Client, editionId: string, seq: number) {
    const roundId = await createTestRound(client, {
      eventEditionId: editionId,
      kind: "quiz",
      slug: `rt-len-${seq}-${Date.now()}`,
      sequence: seq,
      quizExitPolicy: "lenient",
      quizStrikeLimit: 2,
      ...OPEN,
    });
    return roundId;
  }

  it("warns on the first strike and submits on the second", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `RT-W ${Date.now()}`, eventEditionId: editionId });
      const roundId = await lenientRound(client, editionId, 9310);
      const q = await createQuizQuestion(client, roundId, editionId, 0, 2, 0);

      const attempt = await startAttempt(client, teamId, roundId);
      await answer(client, attempt.attempt_id, q.questionId, q.optionIds[0]!);

      const { rows: one } = await client.query(
        `select public.record_quiz_strike($1, $2, $3, 'visibility_hidden') as result`,
        [teamId, roundId, attempt.session_token],
      );
      expect(one[0].result.status).toBe("warned");
      expect(Number(one[0].result.strike_count)).toBe(1);
      expect(Number(one[0].result.strikes_remaining)).toBe(1);

      const { rows: mid } = await client.query(
        `select status from public.quiz_attempts where id = $1`,
        [attempt.attempt_id],
      );
      expect(mid[0].status).toBe("in_progress");

      // No score row may exist while the attempt is merely warned.
      const { rows: noScore } = await client.query(
        `select count(*)::int as n from public.scores where round_id = $1 and team_id = $2`,
        [roundId, teamId],
      );
      expect(noScore[0].n).toBe(0);

      // Past the 3s debounce window, so this counts as a second strike.
      await client.query(
        `update public.quiz_attempts set last_strike_at = now() - interval '10 seconds' where id = $1`,
        [attempt.attempt_id],
      );

      const { rows: two } = await client.query(
        `select public.record_quiz_strike($1, $2, $3, 'navigation') as result`,
        [teamId, roundId, attempt.session_token],
      );
      expect(two[0].result.status).toBe("submitted");
      expect(Number(two[0].result.strike_count)).toBe(2);

      const { rows: final } = await client.query(
        `select status, submit_reason, strike_count, raw_score, correct_count, question_count
         from public.quiz_attempts where id = $1`,
        [attempt.attempt_id],
      );
      expect(final[0]).toMatchObject({ status: "submitted", submit_reason: "navigation", strike_count: 2 });
      expect(Number(final[0].raw_score)).toBe(2);
      expect(final[0].correct_count).toBe(1);
      expect(final[0].question_count).toBe(1);

      const { rows: score } = await client.query(
        `select total, source from public.scores where round_id = $1 and team_id = $2`,
        [roundId, teamId],
      );
      expect(Number(score[0].total)).toBe(2);
      expect(score[0].source).toBe("quiz");
    });
  });

  it("debounces two signals from one physical exit into a single strike", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `RT-D ${Date.now()}`, eventEditionId: editionId });
      const roundId = await lenientRound(client, editionId, 9311);
      await createQuizQuestion(client, roundId, editionId, 0, 1, 0);
      const attempt = await startAttempt(client, teamId, roundId);

      // visibilitychange and the Navigation API's 'navigate' can both fire
      // for one alt-tab; without the debounce this would burn both strikes.
      await client.query(`select public.record_quiz_strike($1, $2, $3, 'visibility_hidden')`, [
        teamId,
        roundId,
        attempt.session_token,
      ]);
      const { rows: second } = await client.query(
        `select public.record_quiz_strike($1, $2, $3, 'navigation') as result`,
        [teamId, roundId, attempt.session_token],
      );

      expect(second[0].result.status).toBe("warned");
      expect(second[0].result.debounced).toBe(true);

      const { rows: after } = await client.query(
        `select status, strike_count from public.quiz_attempts where id = $1`,
        [attempt.attempt_id],
      );
      expect(after[0]).toMatchObject({ status: "in_progress", strike_count: 1 });

      const { rows: events } = await client.query(
        `select count(*)::int as n from public.quiz_events where attempt_id = $1 and kind = 'strike_debounced'`,
        [attempt.attempt_id],
      );
      expect(events[0].n).toBe(1);
    });
  });

  it("exposes warning_pending until it is acknowledged", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `RT-A ${Date.now()}`, eventEditionId: editionId });
      const roundId = await lenientRound(client, editionId, 9312);
      await createQuizQuestion(client, roundId, editionId, 0, 1, 0);
      const attempt = await startAttempt(client, teamId, roundId);

      await client.query(`select public.record_quiz_strike($1, $2, $3, 'visibility_hidden')`, [
        teamId,
        roundId,
        attempt.session_token,
      ]);

      const { rows: warned } = await client.query(`select public.get_quiz_state($1, $2, $3) as s`, [
        teamId,
        roundId,
        attempt.session_token,
      ]);
      expect(warned[0].s.warning_pending).toBe(true);
      expect(warned[0].s.exit_policy).toBe("lenient");
      expect(Number(warned[0].s.strike_limit)).toBe(2);

      await client.query(`select public.ack_quiz_warning($1, $2, $3)`, [
        teamId,
        roundId,
        attempt.session_token,
      ]);

      const { rows: acked } = await client.query(`select public.get_quiz_state($1, $2, $3) as s`, [
        teamId,
        roundId,
        attempt.session_token,
      ]);
      expect(acked[0].s.warning_pending).toBe(false);
    });
  });

  it("resumes an attempt with a rotated token, invalidating the old one", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `RT-R ${Date.now()}`, eventEditionId: editionId });
      const roundId = await lenientRound(client, editionId, 9313);
      const q = await createQuizQuestion(client, roundId, editionId, 0, 1, 0);
      const attempt = await startAttempt(client, teamId, roundId);
      await answer(client, attempt.attempt_id, q.questionId, q.optionIds[0]!);

      const { rows: resumed } = await client.query(`select public.resume_quiz_attempt($1, $2) as r`, [
        teamId,
        roundId,
      ]);
      expect(resumed[0].r.status).toBe("in_progress");
      const newToken = resumed[0].r.session_token as string;
      expect(newToken).not.toBe(attempt.session_token);

      // The stale tab's next poll must fail — this is what keeps a second
      // device from sharing the attempt (AT-QZ-05).
      const err = await expectRejection(client, `select public.get_quiz_state($1, $2, $3)`, [
        teamId,
        roundId,
        attempt.session_token,
      ]);
      expect(err.message).toContain("[session_replaced]");

      // Answers survive the resume, and the saved option comes back.
      const { rows: state } = await client.query(`select public.get_quiz_state($1, $2, $3) as s`, [
        teamId,
        roundId,
        newToken,
      ]);
      expect(state[0].s.status).toBe("in_progress");
      expect(state[0].s.saved_option_id).toBe(q.optionIds[0]);
      expect(Number(state[0].s.answered_count)).toBe(1);
    });
  });
});

describe("participant score display: correct_count / question_count", () => {
  it("records how many questions were right, distinct from the weighted point total", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const teamId = await createTestTeam(client, { name: `RT-C ${Date.now()}`, eventEditionId: editionId });
      const roundId = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-count-${Date.now()}`,
        sequence: 9320,
        ...OPEN,
      });

      // Mirrors the real Stat Sprint shape: mixed 0.5/1/2 weights, so the
      // correct-answer count and the point total genuinely differ.
      const q1 = await createQuizQuestion(client, roundId, editionId, 0, 0.5, 0);
      const q2 = await createQuizQuestion(client, roundId, editionId, 1, 2, 0);
      const q3 = await createQuizQuestion(client, roundId, editionId, 2, 1, 0);

      const attempt = await startAttempt(client, teamId, roundId);
      await answer(client, attempt.attempt_id, q1.questionId, q1.optionIds[0]!); // right, 0.5
      await answer(client, attempt.attempt_id, q2.questionId, q2.optionIds[1]!); // wrong
      await answer(client, attempt.attempt_id, q3.questionId, q3.optionIds[0]!); // right, 1

      const { rows: submitted } = await client.query(
        `select public.submit_quiz_attempt($1, $2, 'manual', $3) as r`,
        [teamId, roundId, attempt.session_token],
      );
      const r = submitted[0].r;
      expect(Number(r.raw_score)).toBe(1.5);
      expect(Number(r.max_score)).toBe(3.5);
      expect(Number(r.correct_count)).toBe(2);
      expect(Number(r.question_count)).toBe(3);
      expect(Number(r.answered_count)).toBe(3);
      expect(r.submitted_at).toBeTruthy();
      expect(r.submit_reason).toBe("manual");

      // 2 of 3 correct but 1.5 of 3.5 points — the exact mismatch that made
      // teams believe their score was wrong.
      expect(Number(r.correct_count) / Number(r.question_count)).not.toBeCloseTo(
        Number(r.raw_score) / Number(r.max_score),
      );
    });
  });
});

describe("stage_standings: a superseding round replaces the original", () => {
  it("counts the re-attempt instead of the original, and only for teams that took it", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const cleanFinisher = await createTestTeam(client, { name: `RT-SS A ${Date.now()}`, eventEditionId: editionId });
      const retook = await createTestTeam(client, { name: `RT-SS B ${Date.now()}`, eventEditionId: editionId });
      const invitedNoShow = await createTestTeam(client, { name: `RT-SS C ${Date.now()}`, eventEditionId: editionId });
      const retookWorse = await createTestTeam(client, { name: `RT-SS D ${Date.now()}`, eventEditionId: editionId });

      const original = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-ss-orig-${Date.now()}`,
        sequence: 9330,
      });
      const retest = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-ss-retest-${Date.now()}`,
        sequence: 9331,
        supersedesRoundId: original,
        isInviteOnly: true,
        quizExitPolicy: "lenient",
        quizStrikeLimit: 2,
      });

      const { rows: stageRows } = await client.query<{ id: string }>(
        `select id from public.stages where event_edition_id = $1 and code = 'r1_r2'`,
        [editionId],
      );
      const stageId = stageRows[0]!.id;
      await client.query(
        `insert into public.stage_rounds (stage_id, round_id, weight) values ($1, $2, 1), ($1, $3, 1)`,
        [stageId, original, retest],
      );

      await client.query(
        `insert into public.scores (round_id, team_id, total) values
           ($1, $2, 30), ($1, $3, 12), ($1, $4, 12), ($1, $5, 28)`,
        [original, cleanFinisher, retook, invitedNoShow, retookWorse],
      );
      await client.query(
        `insert into public.scores (round_id, team_id, total) values ($1, $2, 26), ($1, $3, 4)`,
        [retest, retook, retookWorse],
      );

      const { rows: standings } = await client.query(
        `select team_id, aggregate from public.stage_standings($1)`,
        [stageId],
      );
      const byTeam = new Map(standings.map((s) => [s.team_id, Number(s.aggregate)]));

      // Never took the re-attempt: original stands.
      expect(byTeam.get(cleanFinisher)).toBe(30);
      // Invited but never sat it: original still stands (no retest row).
      expect(byTeam.get(invitedNoShow)).toBe(12);
      // Took it: 26 replaces 12, not 12 + 26.
      expect(byTeam.get(retook)).toBe(26);
      // Took it and did WORSE: 4 still replaces 28 — the agreed rule, and
      // the one somebody will dispute.
      expect(byTeam.get(retookWorse)).toBe(4);

      // Both score rows survive; only the aggregate ignores the original.
      const { rows: kept } = await client.query(
        `select count(*)::int as n from public.scores where team_id = $1 and round_id in ($2, $3)`,
        [retook, original, retest],
      );
      expect(kept[0].n).toBe(2);
    });
  });

  it("still ranks a team with no scores at all as 0 rather than dropping it", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const scored = await createTestTeam(client, { name: `RT-SS Z1 ${Date.now()}`, eventEditionId: editionId });
      const unscored = await createTestTeam(client, { name: `RT-SS Z2 ${Date.now()}`, eventEditionId: editionId });

      const original = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-ss0-orig-${Date.now()}`,
        sequence: 9332,
      });
      const retest = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-ss0-retest-${Date.now()}`,
        sequence: 9333,
        supersedesRoundId: original,
      });

      const { rows: stageRows } = await client.query<{ id: string }>(
        `select id from public.stages where event_edition_id = $1 and code = 'r1_r2'`,
        [editionId],
      );
      const stageId = stageRows[0]!.id;
      await client.query(
        `insert into public.stage_rounds (stage_id, round_id, weight) values ($1, $2, 1), ($1, $3, 1)`,
        [stageId, original, retest],
      );
      await client.query(`insert into public.scores (round_id, team_id, total) values ($1, $2, 10)`, [
        retest,
        scored,
      ]);

      const { rows: standings } = await client.query(
        `select team_id, aggregate from public.stage_standings($1)`,
        [stageId],
      );
      const byTeam = new Map(standings.map((s) => [s.team_id, Number(s.aggregate)]));
      expect(byTeam.get(scored)).toBe(10);
      expect(byTeam.get(unscored)).toBe(0);
    });
  });

  it("rejects a supersede chain", async () => {
    await withTx(async (client) => {
      const editionId = await getActiveEventEditionId(client);
      const a = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-chain-a-${Date.now()}`,
        sequence: 9340,
      });
      const b = await createTestRound(client, {
        eventEditionId: editionId,
        kind: "quiz",
        slug: `rt-chain-b-${Date.now()}`,
        sequence: 9341,
        supersedesRoundId: a,
      });

      const err = await expectRejection(
        client,
        // $2 is cast explicitly: slug is citext and title is text, so
        // reusing an untyped parameter for both makes Postgres give up on
        // deducing its type before it ever reaches the trigger under test.
        `insert into public.rounds (event_edition_id, kind, sequence, slug, title, supersedes_round_id)
         values ($1, 'quiz', 9342, $2::text, $2::text, $3)`,
        [editionId, `rt-chain-c-${Date.now()}`, b],
      );
      expect(err.message).toContain("[invalid_supersede]");
    });
  });
});
