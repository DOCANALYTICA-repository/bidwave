import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { QuizRunner } from "@/app/app/quiz/[roundId]/quiz-runner";

export const metadata: Metadata = { title: "Quiz" };

// The runner branches on the round's exit policy and on whether an attempt
// is already in progress; neither may be served from a cached payload.
export const dynamic = "force-dynamic";

export default async function TeamQuizPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: round } = await supabase
    .from("rounds")
    .select("id, kind, title, instructions, is_invite_only, quiz_exit_policy, quiz_strike_limit")
    .eq("id", roundId)
    .maybeSingle();
  if (!round || round.kind !== "quiz") notFound();

  // Invite-only rounds (the Round 1 re-attempt): a team that isn't on the
  // allowlist gets a 404 rather than a preflight screen whose Start button
  // would fail with [not_eligible]. start_quiz_attempt still enforces it.
  if (round.is_invite_only) {
    const { data: eligible } = await supabase
      .from("round_eligible_teams")
      .select("round_id")
      .eq("round_id", roundId)
      .eq("team_id", user.id)
      .maybeSingle();
    if (!eligible) notFound();
  }

  const { data: attempt } = await supabase
    .from("quiz_attempts")
    .select("status")
    .eq("round_id", roundId)
    .eq("team_id", user.id)
    .neq("status", "archived")
    .maybeSingle();

  return (
    <QuizRunner
      roundId={roundId}
      roundTitle={round.title}
      instructions={round.instructions}
      exitPolicy={round.quiz_exit_policy}
      strikeLimit={round.quiz_strike_limit}
      alreadySubmitted={attempt?.status === "submitted"}
      hasInProgressAttempt={attempt?.status === "in_progress"}
    />
  );
}
