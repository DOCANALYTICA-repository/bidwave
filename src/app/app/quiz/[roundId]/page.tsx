import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { QuizRunner } from "@/app/app/quiz/[roundId]/quiz-runner";

export const metadata: Metadata = { title: "Quiz" };

export default async function TeamQuizPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: round } = await supabase.from("rounds").select("id, kind").eq("id", roundId).maybeSingle();
  if (!round || round.kind !== "quiz") notFound();

  const { data: attempt } = await supabase
    .from("quiz_attempts")
    .select("status")
    .eq("round_id", roundId)
    .eq("team_id", user.id)
    .neq("status", "archived")
    .maybeSingle();

  return <QuizRunner roundId={roundId} alreadySubmitted={attempt?.status === "submitted"} />;
}
