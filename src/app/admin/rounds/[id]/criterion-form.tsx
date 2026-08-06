"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { adminSaveRubricCriterion, type RoundActionState } from "@/app/admin/rounds/actions";

const roundActionInitialState: RoundActionState = { status: "idle" };

export function CriterionForm({ roundId, position }: { roundId: string; position: number }) {
  const [state, formAction, isPending] = useActionState(adminSaveRubricCriterion, roundActionInitialState);

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.status === "success") toast.success("Criterion added.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
      <input type="hidden" name="roundId" value={roundId} />
      <input type="hidden" name="position" value={position} />
      <div className="space-y-1.5">
        <Label htmlFor="criterion-label">Criterion</Label>
        <Input id="criterion-label" name="label" required className="w-40" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="criterion-max">Max value</Label>
        <Input id="criterion-max" name="maxValue" type="number" step="0.01" required className="w-24" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="criterion-weight">Weight</Label>
        <Input id="criterion-weight" name="weight" type="number" step="0.01" defaultValue={1} className="w-24" />
      </div>
      {state.status === "error" && state.formError && <p className="text-xs text-unsold">{state.formError}</p>}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Adding…" : "Add criterion"}
      </Button>
    </form>
  );
}
