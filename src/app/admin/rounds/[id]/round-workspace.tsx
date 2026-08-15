"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/bidwave";
import { MaterialForm } from "@/app/admin/rounds/[id]/material-form";
import { CriterionForm } from "@/app/admin/rounds/[id]/criterion-form";
import { ScoreRow } from "@/app/admin/rounds/[id]/score-row";
import { QuizBuilder } from "@/app/admin/rounds/[id]/quiz-builder";
import { RoundPolicyForm } from "@/app/admin/rounds/[id]/round-policy-form";
import {
  EligibilityPicker,
  type EligibilityTeamRow,
} from "@/app/admin/rounds/[id]/eligibility-picker";
import { adminDeleteMaterial, adminDeleteRubricCriterion, adminPublishScoresForRound, getSubmissionFileUrl } from "@/app/admin/rounds/actions";

type Team = { id: string; name: string };
type Material = { id: string; title: string; kind: string; url: string | null; body: string | null; public_release: boolean };
type Criterion = { id: string; label: string; max_value: number; weight: number };
type Submission = {
  team_id: string;
  status: string;
  submitted_at: string | null;
  submission_files: { id: string; storage_path: string; file_name: string; superseded_at: string | null }[];
};
type Score = { team_id: string; id: string; total: number; max_total: number | null; published: boolean; updated_at: string; notes: string | null };

type QuizQuestion = {
  id: string;
  position: number;
  prompt: string;
  timer_seconds: number;
  weight: number;
  is_active: boolean;
  options: { id: string; position: number; label: string; is_correct: boolean }[];
};
type QuizAttempt = {
  id: string;
  team_id: string;
  team_name: string;
  status: string;
  raw_score: number | null;
  max_score: number | null;
  exitEvents: { kind: string; created_at: string }[];
};
type RoundPolicy = {
  supersedesRoundId: string | null;
  supersededRoundTitle: string | null;
  isInviteOnly: boolean;
  quizExitPolicy: "strict" | "lenient";
  quizStrikeLimit: number;
  otherRounds: { id: string; title: string }[];
  roundIsOpen: boolean;
};

export function RoundWorkspace({
  roundId,
  kind,
  teams,
  materials,
  criteria,
  submissions,
  scores,
  quizQuestions,
  quizAttempts,
  policy,
  eligibilityTeams,
}: {
  roundId: string;
  kind: string;
  teams: Team[];
  materials: Material[];
  criteria: Criterion[];
  submissions: Submission[];
  scores: Score[];
  quizQuestions: QuizQuestion[];
  quizAttempts: QuizAttempt[];
  policy: RoundPolicy;
  eligibilityTeams: EligibilityTeamRow[];
}) {
  const submissionByTeam = new Map(submissions.map((s) => [s.team_id, s]));
  const scoreByTeam = new Map(scores.map((s) => [s.team_id, s]));
  const unpublishedCount = scores.filter((s) => !s.published).length;

  return (
    <Tabs defaultValue="materials">
      <TabsList>
        <TabsTrigger value="materials">Materials</TabsTrigger>
        {kind !== "quiz" && kind !== "auction" && <TabsTrigger value="rubric">Rubric</TabsTrigger>}
        {kind === "submission" && <TabsTrigger value="submissions">Submissions</TabsTrigger>}
        {kind === "quiz" && <TabsTrigger value="quiz">Quiz bank</TabsTrigger>}
        {kind === "quiz" && <TabsTrigger value="policy">Round policy</TabsTrigger>}
        {kind === "quiz" && policy.isInviteOnly && (
          <TabsTrigger value="eligibility">Eligibility</TabsTrigger>
        )}
        {kind !== "auction" && <TabsTrigger value="scores">Scores</TabsTrigger>}
      </TabsList>

      <TabsContent value="materials" className="space-y-3 pt-4">
        <ul className="space-y-2">
          {materials.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <span>
                {m.title} <span className="text-xs text-ink-3">({m.kind})</span>
                {m.public_release && <StatusPill status="qualified" label="Public-releasable" className="ml-2" />}
              </span>
              <Button
                size="sm"
                variant="tile"
                onClick={async () => {
                  await adminDeleteMaterial(m.id, roundId);
                  toast.success("Material deleted.");
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
        <MaterialForm roundId={roundId} />
      </TabsContent>

      {kind !== "quiz" && kind !== "auction" && (
      <TabsContent value="rubric" className="space-y-3 pt-4">
        <ul className="space-y-2">
          {criteria.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <span>
                {c.label} · max {c.max_value} · weight {c.weight}
              </span>
              <Button
                size="sm"
                variant="tile"
                onClick={async () => {
                  await adminDeleteRubricCriterion(c.id, roundId);
                  toast.success("Criterion deleted.");
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
        <CriterionForm roundId={roundId} position={criteria.length} />
      </TabsContent>
      )}

      {kind === "submission" && (
      <TabsContent value="submissions" className="space-y-2 pt-4">
        {teams.map((t) => {
          const submission = submissionByTeam.get(t.id);
          const files = (submission?.submission_files ?? []).filter((f) => !f.superseded_at);
          return (
            <div key={t.id} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t.name}</span>
                <StatusPill status={submission?.status === "submitted" ? "submitted" : "closed"} label={submission?.status ?? "not submitted"} />
              </div>
              {files.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {files.map((f) => (
                    <FileLink key={f.id} storagePath={f.storage_path} fileName={f.file_name} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </TabsContent>
      )}

      {kind === "quiz" && (
        <TabsContent value="quiz" className="pt-4">
          <QuizBuilder roundId={roundId} questions={quizQuestions} attempts={quizAttempts} />
        </TabsContent>
      )}

      {kind === "quiz" && (
        <TabsContent value="policy" className="max-w-xl pt-4">
          <RoundPolicyForm
            roundId={roundId}
            otherRounds={policy.otherRounds}
            supersedesRoundId={policy.supersedesRoundId}
            isInviteOnly={policy.isInviteOnly}
            quizExitPolicy={policy.quizExitPolicy}
            quizStrikeLimit={policy.quizStrikeLimit}
          />
        </TabsContent>
      )}

      {kind === "quiz" && policy.isInviteOnly && (
        <TabsContent value="eligibility" className="pt-4">
          <EligibilityPicker
            roundId={roundId}
            teams={eligibilityTeams}
            supersededRoundTitle={policy.supersededRoundTitle}
            roundIsOpen={policy.roundIsOpen}
          />
        </TabsContent>
      )}

      {kind !== "auction" && (
      <TabsContent value="scores" className="space-y-3 pt-4">
        <div className="flex items-center justify-end gap-3">
          {/* Publishing only affects the score rows that exist when it runs;
              anything submitted afterwards stays invisible to its team. */}
          {unpublishedCount > 0 && (
            <span className="rounded border border-gold/40 bg-gold/10 px-2 py-1 text-xs text-gold">
              {unpublishedCount} scored team(s) cannot see their score yet
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await adminPublishScoresForRound(roundId);
              toast.success("All scores published.");
            }}
          >
            Publish all scores
          </Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-2">
                <th className="px-3 py-2 text-xs font-semibold uppercase text-ink-2">Team</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase text-ink-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                const submission = submissionByTeam.get(t.id);
                const score = scoreByTeam.get(t.id);
                return (
                  <ScoreRow
                    key={t.id}
                    roundId={roundId}
                    teamId={t.id}
                    teamName={t.name}
                    submissionStatus={submission?.status}
                    criteria={criteria.map((c) => ({ id: c.id, label: c.label, max_value: c.max_value }))}
                    existing={score ?? null}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </TabsContent>
      )}
    </Tabs>
  );
}

function FileLink({ storagePath, fileName }: { storagePath: string; fileName: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <li>
      <Button
        type="button"
        variant="tile"
        size="xs"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          const url = await getSubmissionFileUrl(storagePath);
          setLoading(false);
          if (url) window.open(url, "_blank", "noopener,noreferrer");
        }}
      >
        {loading ? "Loading…" : fileName}
      </Button>
    </li>
  );
}
