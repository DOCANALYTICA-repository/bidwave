import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/bidwave";
import { RoundWorkspace } from "@/app/admin/rounds/[id]/round-workspace";

export const metadata: Metadata = { title: "Round workspace" };

export default async function AdminRoundWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: round } = await supabase.from("rounds_with_status").select("*").eq("id", id).maybeSingle();
  if (!round) notFound();

  const [{ data: teams }, { data: materials }, { data: criteria }, { data: submissions }, { data: scores }] =
    await Promise.all([
      supabase.from("teams").select("id, name").order("name"),
      supabase.from("round_materials").select("*").eq("round_id", id).order("position"),
      supabase.from("rubric_criteria").select("*").eq("round_id", id).order("position"),
      supabase
        .from("submissions")
        .select("team_id, status, submitted_at, submission_files(id, storage_path, file_name, superseded_at)")
        .eq("round_id", id),
      supabase.from("scores").select("*").eq("round_id", id),
    ]);

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
        quizQuestions={quizQuestions}
        quizAttempts={quizAttempts}
      />
    </div>
  );
}
