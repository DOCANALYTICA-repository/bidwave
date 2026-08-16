import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/bidwave";
import { RoundWorkspace } from "@/app/admin/rounds/[id]/round-workspace";
import type { EligibilityTeamRow } from "@/app/admin/rounds/[id]/eligibility-picker";

export const metadata: Metadata = { title: "Round workspace" };

export default async function AdminRoundWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: round } = await supabase.from("rounds_with_status").select("*").eq("id", id).maybeSingle();
  if (!round) notFound();

  const [{ data: teams }, { data: materials }, { data: criteria }, { data: submissions }, { data: scores }] =
    await Promise.all([
      // Scoped to the round's own edition — admin RLS returns every team in
      // the project, so an unfiltered list would mix other editions' teams
      // into this round's scoring UI.
      supabase
        .from("teams")
        .select("id, name")
        .eq("event_edition_id", round.event_edition_id)
        .order("name"),
      supabase.from("round_materials").select("*").eq("round_id", id).order("position"),
      supabase.from("rubric_criteria").select("*").eq("round_id", id).order("position"),
      supabase
        .from("submissions")
        .select(
          "team_id, status, submitted_at, submission_files(id, storage_path, external_url, file_name, superseded_at)",
        )
        .eq("round_id", id),
      supabase.from("scores").select("*").eq("round_id", id),
    ]);

  // Saved rubric values. Without these the Scores tab renders empty inputs for
  // every rubric round even when scores exist — the totals are in `scores` and
  // the per-criterion values in `score_criterion_values`, and neither was ever
  // fetched into the workspace, so a saved score looked lost.
  const criterionValuesByTeam: Record<string, Record<string, number>> = {};
  if ((criteria ?? []).length > 0 && (scores ?? []).length > 0) {
    const scoreIdToTeam = new Map((scores ?? []).map((s) => [s.id, s.team_id]));
    const { data: values } = await supabase
      .from("score_criterion_values")
      .select("score_id, criterion_id, value")
      .in("score_id", [...scoreIdToTeam.keys()]);
    for (const v of values ?? []) {
      const teamId = scoreIdToTeam.get(v.score_id);
      if (!teamId) continue;
      (criterionValuesByTeam[teamId] ??= {})[v.criterion_id] = Number(v.value);
    }
  }

  let quizQuestions: {
    id: string;
    position: number;
    prompt: string;
    timer_seconds: number;
    weight: number;
    is_active: boolean;
    options: { id: string; position: number; label: string; is_correct: boolean }[];
  }[] = [];
  let quizAttempts: {
    id: string;
    team_id: string;
    team_name: string;
    status: string;
    raw_score: number | null;
    max_score: number | null;
    exitEvents: { kind: string; created_at: string }[];
  }[] = [];
  if (round.kind === "quiz") {
    const [{ data: questions }, { data: attempts }] = await Promise.all([
      supabase
        .from("quiz_questions")
        .select("id, position, prompt, timer_seconds, weight, is_active, quiz_options(id, position, label, is_correct)")
        .eq("round_id", id)
        .order("position"),
      supabase
        .from("quiz_attempts")
        .select("id, team_id, status, raw_score, max_score, teams(name)")
        .eq("round_id", id)
        .neq("status", "archived"),
    ]);
    quizQuestions = (questions ?? []).map(({ quiz_options, ...q }) => ({
      ...q,
      options: ((quiz_options ?? []) as { id: string; position: number; label: string; is_correct: boolean }[])
        .slice()
        .sort((a, b) => a.position - b.position),
    })) as never;

    // Audit high-priority #7: the admin monitor never surfaced
    // quiz_events (exit/reconnect audit trail) at all.
    const attemptIds = (attempts ?? []).map((a) => a.id);
    const { data: exitEvents } =
      attemptIds.length > 0
        ? await supabase
            .from("quiz_events")
            .select("attempt_id, kind, created_at")
            .in("attempt_id", attemptIds)
            .order("created_at", { ascending: true })
        : { data: [] };
    const eventsByAttempt = new Map<string, { kind: string; created_at: string }[]>();
    for (const e of exitEvents ?? []) {
      if (!eventsByAttempt.has(e.attempt_id)) eventsByAttempt.set(e.attempt_id, []);
      eventsByAttempt.get(e.attempt_id)!.push({ kind: e.kind, created_at: e.created_at });
    }

    quizAttempts = (attempts ?? []).map((a) => ({
      id: a.id,
      team_id: a.team_id,
      team_name: (a.teams as unknown as { name: string } | null)?.name ?? "—",
      status: a.status,
      raw_score: a.raw_score,
      max_score: a.max_score,
      exitEvents: eventsByAttempt.get(a.id) ?? [],
    }));
  }

  // Round-policy + eligibility context (the Round 1 re-attempt). Only the
  // quiz workspace surfaces these, so everything here is skipped otherwise.
  const [{ data: otherRounds }, { data: supersededRound }, { data: eligibleRows }] = await Promise.all([
    round.kind === "quiz"
      ? supabase
          .from("rounds")
          .select("id, title")
          .eq("event_edition_id", round.event_edition_id)
          .neq("id", id)
          .order("sequence")
      : Promise.resolve({ data: [] }),
    round.supersedes_round_id
      ? supabase.from("rounds").select("id, title").eq("id", round.supersedes_round_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Only an invite-only round has an allowlist to show; every other quiz
    // round would pay for these two queries (and the prior-attempt fetch
    // below) on every workspace load for nothing.
    round.is_invite_only
      ? supabase.from("round_eligible_teams").select("team_id").eq("round_id", id)
      : Promise.resolve({ data: [] }),
  ]);

  let eligibilityTeams: EligibilityTeamRow[] = [];
  if (round.is_invite_only) {
    // Prior-round context so the admin can curate quickly. Purely
    // informational — nothing here selects anyone.
    const { data: priorAttempts } = round.supersedes_round_id
      ? await supabase
          .from("quiz_attempts")
          .select("team_id, status, submit_reason, raw_score, max_score, correct_count, question_count")
          .eq("round_id", round.supersedes_round_id)
          .neq("status", "archived")
      : { data: [] };
    const priorByTeam = new Map((priorAttempts ?? []).map((a) => [a.team_id, a]));
    const eligibleIds = new Set((eligibleRows ?? []).map((r) => r.team_id));
    const attemptTeamIds = new Set(quizAttempts.map((a) => a.team_id));

    eligibilityTeams = (teams ?? []).map((t) => {
      const prior = priorByTeam.get(t.id);
      return {
        id: t.id,
        name: t.name,
        priorStatus: prior?.status ?? null,
        priorReason: prior?.submit_reason ?? null,
        priorScore: prior?.raw_score ?? null,
        priorMax: prior?.max_score ?? null,
        priorCorrect: prior?.correct_count ?? null,
        priorQuestions: prior?.question_count ?? null,
        eligible: eligibleIds.has(t.id),
        hasAttempt: attemptTeamIds.has(t.id),
      };
    });
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
      <BackLink href="/admin/rounds" label="Back to rounds" />
      <div>
        <h1 className="font-display text-2xl">{round.title}</h1>
        <p className="text-sm text-ink-2">
          {round.kind} · sequence {round.sequence} · {round.status}
        </p>
      </div>
      <RoundWorkspace
        roundId={id}
        kind={round.kind}
        teams={teams ?? []}
        materials={materials ?? []}
        criteria={criteria ?? []}
        submissions={(submissions ?? []) as never}
        scores={(scores ?? []) as never}
        criterionValuesByTeam={criterionValuesByTeam}
        quizQuestions={quizQuestions}
        quizAttempts={quizAttempts}
        policy={{
          supersedesRoundId: round.supersedes_round_id,
          supersededRoundTitle: supersededRound?.title ?? null,
          isInviteOnly: round.is_invite_only,
          quizExitPolicy: round.quiz_exit_policy,
          quizStrikeLimit: round.quiz_strike_limit,
          otherRounds: otherRounds ?? [],
          roundIsOpen: round.status === "open",
        }}
        eligibilityTeams={eligibilityTeams}
      />
    </div>
  );
}
