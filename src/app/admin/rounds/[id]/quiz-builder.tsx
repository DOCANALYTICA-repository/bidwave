"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/bidwave";
import {
  adminSaveQuizQuestion,
  adminDeleteQuizQuestion,
  adminResetQuizAttemptAction,
  type QuizActionState,
} from "@/app/admin/rounds/quiz-actions";

const quizActionInitialState: QuizActionState = { status: "idle" };

// Any server-rendered toLocaleTimeString call needs an explicit
// locale/options — a zero-arg call produced a real hydration mismatch
// elsewhere in this codebase (console-sales-log.tsx).
function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type QuestionOption = { id: string; position: number; label: string; is_correct: boolean };
type Question = {
  id: string;
  position: number;
  prompt: string;
  timer_seconds: number;
  weight: number;
  is_active: boolean;
  options: QuestionOption[];
};

const BLANK_OPTIONS = [
  { label: "", isCorrect: true },
  { label: "", isCorrect: false },
  { label: "", isCorrect: false },
  { label: "", isCorrect: false },
];
type Attempt = {
  id: string;
  team_id: string;
  team_name: string;
  status: string;
  raw_score: number | null;
  max_score: number | null;
  exitEvents: { kind: string; created_at: string }[];
};

export function QuizBuilder({
  roundId,
  questions,
  attempts,
}: {
  roundId: string;
  questions: Question[];
  attempts: Attempt[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [weight, setWeight] = useState(1);
  const [isActive, setIsActive] = useState(true);
  const [options, setOptions] = useState<{ label: string; isCorrect: boolean }[]>(BLANK_OPTIONS);
  const [state, formAction, isPending] = useActionState(adminSaveQuizQuestion, quizActionInitialState);

  function startEdit(q: Question) {
    setEditingId(q.id);
    setPrompt(q.prompt);
    setTimerSeconds(q.timer_seconds);
    setWeight(q.weight);
    setIsActive(q.is_active);
    const sorted = q.options.slice().sort((a, b) => a.position - b.position);
    setOptions(
      sorted.length > 0
        ? sorted.map((o) => ({ label: o.label, isCorrect: o.is_correct }))
        : BLANK_OPTIONS,
    );
  }

  function cancelEdit() {
    setEditingId(null);
    setPrompt("");
    setTimerSeconds(60);
    setWeight(1);
    setIsActive(true);
    setOptions(BLANK_OPTIONS);
  }

  useEffect(() => {
    if (state.status === "success") {
      toast.success(editingId ? "Question updated." : "Question added.");
      // Resetting the form back to its blank/add state after a successful
      // save is exactly what this effect exists to do — it's the "clear
      // local UI state after synchronizing with an external result" case,
      // not a derived-state anti-pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      cancelEdit();
    }
    if (state.status === "error" && state.formError) toast.error(state.formError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="space-y-6">
      <ul className="space-y-2">
        {questions.map((q) => (
          <li key={q.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <span>
              #{q.position} {q.prompt} · {q.timer_seconds}s{q.weight > 1 ? " ★" : ""}
              {!q.is_active && <StatusPill status="closed" label="Inactive" className="ml-2" />}
            </span>
            <span className="flex items-center gap-1">
              <Button size="sm" variant="tile" onClick={() => startEdit(q)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="tile"
                onClick={async () => {
                  await adminDeleteQuizQuestion(q.id, roundId);
                  toast.success("Question deleted.");
                }}
              >
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>

      <form
        key={editingId ?? "new"}
        action={(fd) => {
          if (editingId) fd.set("questionId", editingId);
          fd.set(
            "options",
            JSON.stringify(
              options.map((o, i) => ({ position: i, label: o.label, is_correct: o.isCorrect })),
            ),
          );
          formAction(fd);
        }}
        className="space-y-3 rounded-xl border border-border bg-card p-4"
      >
        <input type="hidden" name="roundId" value={roundId} />
        <input type="hidden" name="position" value={editingId ? questions.find((q) => q.id === editingId)?.position ?? 0 : questions.length} />
        <div className="space-y-1.5">
          <Label htmlFor="qz-prompt">Prompt</Label>
          <Textarea id="qz-prompt" name="prompt" rows={2} required value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="qz-timer">Timer (seconds)</Label>
            <Input
              id="qz-timer"
              name="timerSeconds"
              type="number"
              min={5}
              max={900}
              required
              value={timerSeconds}
              onChange={(e) => setTimerSeconds(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qz-weight">Weight</Label>
            <Input
              id="qz-weight"
              name="weight"
              type="number"
              step="0.5"
              min={0.5}
              required
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
            />
          </div>
          <label className="flex items-center gap-2 self-end text-sm text-ink-2">
            <input type="checkbox" name="isActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        </div>

        <div className="space-y-2">
          <Label>Options (mark exactly one correct)</Label>
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="correctOption"
                checked={opt.isCorrect}
                onChange={() =>
                  setOptions((os) => os.map((o, j) => ({ ...o, isCorrect: j === i })))
                }
              />
              <Input
                value={opt.label}
                onChange={(e) =>
                  setOptions((os) => os.map((o, j) => (j === i ? { ...o, label: e.target.value } : o)))
                }
                placeholder={`Option ${i + 1}`}
              />
            </div>
          ))}
        </div>

        {state.status === "error" && state.formError && <p className="text-xs text-unsold">{state.formError}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving…" : editingId ? "Save changes" : "Add question"}
          </Button>
          {editingId && (
            <Button type="button" size="sm" variant="tile" onClick={cancelEdit}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>

      <div className="space-y-2">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">Attempts</h3>
        {attempts.length === 0 ? (
          <p className="text-sm text-ink-2">No attempts yet.</p>
        ) : (
          <ul className="space-y-1">
            {attempts.map((a) => (
              <li key={a.id} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    {a.team_name} — {a.status}
                    {a.raw_score != null && ` (${a.raw_score}/${a.max_score})`}
                  </span>
                  {a.status === "in_progress" && (
                    <Button
                      size="sm"
                      variant="tile"
                      onClick={async () => {
                        await adminResetQuizAttemptAction(a.id, roundId, "admin reset");
                        toast.success(`${a.team_name}'s attempt reset.`);
                      }}
                    >
                      Reset attempt
                    </Button>
                  )}
                </div>
                {a.exitEvents.length > 0 && (
                  <p className="mt-1 text-xs text-ink-3">
                    Exit events: {a.exitEvents.map((e) => `${e.kind} (${formatTime(e.created_at)})`).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
