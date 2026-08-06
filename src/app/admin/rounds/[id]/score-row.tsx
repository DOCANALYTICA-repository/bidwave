"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { adminSaveScore, adminSetScorePublished, type RoundActionState } from "@/app/admin/rounds/actions";

const roundActionInitialState: RoundActionState = { status: "idle" };

type Criterion = { id: string; label: string; max_value: number };
type ExistingScore = {
  id: string;
  total: number;
  max_total: number | null;
  published: boolean;
  updated_at: string;
  notes: string | null;
} | null;

export function ScoreRow({
  roundId,
  teamId,
  teamName,
  submissionStatus,
  criteria,
  existing,
}: {
  roundId: string;
  teamId: string;
  teamName: string;
  submissionStatus?: string;
  criteria: Criterion[];
  existing: ExistingScore;
}) {
  const [criterionValues, setCriterionValues] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(existing?.total?.toString() ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(adminSaveScore, roundActionInitialState);

  useEffect(() => {
    if (state.status === "success") toast.success(`Score saved for ${teamName}.`);
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state, teamName]);

  const hasCriteria = criteria.length > 0;

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 text-sm">
        {teamName}
        {submissionStatus && <span className="ml-2 text-xs text-ink-3">{submissionStatus}</span>}
      </td>
      <td className="px-3 py-2">
        <form
          noValidate
          action={(fd) => {
            if (hasCriteria) {
              const overMax = criteria.find((c) => {
                const raw = criterionValues[c.id];
                const value = raw ? Number(raw) : 0;
                return Number.isFinite(value) && value > c.max_value;
              });
              if (overMax) {
                setValidationError(`${overMax.label}: score can't exceed ${overMax.max_value}.`);
                return;
              }
            }
            setValidationError(null);
            fd.set("roundId", roundId);
            fd.set("teamId", teamId);
            fd.set("expectedUpdatedAt", existing?.updated_at ?? "");
            fd.set("total", total || "0");
            if (hasCriteria) {
              fd.set(
                "criterionValues",
                JSON.stringify(
                  criteria.map((c) => ({ criterion_id: c.id, value: criterionValues[c.id] || "0" })),
                ),
              );
            }
            formAction(fd);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          {hasCriteria ? (
            criteria.map((c) => (
              <div key={c.id} className="flex flex-col">
                <span className="text-[10px] text-ink-3">{c.label} (max {c.max_value})</span>
                <Input
                  className="w-20"
                  type="number"
                  step="0.01"
                  defaultValue={criterionValues[c.id]}
                  onChange={(e) => setCriterionValues((v) => ({ ...v, [c.id]: e.target.value }))}
                />
              </div>
            ))
          ) : (
            <Input
              className="w-24"
              type="number"
              step="0.01"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
          )}
          <Button type="submit" size="sm" variant="outline" disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
          {existing && (
            <Button
              type="button"
              size="sm"
              variant="tile"
              onClick={async () => {
                const willPublish = !existing.published;
                await adminSetScorePublished(existing.id, roundId, willPublish);
                toast.success(willPublish ? "Score published." : "Score unpublished.");
              }}
            >
              {existing.published ? "Unpublish" : "Publish"}
            </Button>
          )}
        </form>
        {validationError && <p className="mt-1 text-xs text-unsold">{validationError}</p>}
        {!validationError && state.status === "error" && state.formError && (
          <p className="mt-1 text-xs text-unsold">{state.formError}</p>
        )}
      </td>
    </tr>
  );
}
