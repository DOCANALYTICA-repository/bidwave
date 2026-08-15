"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminSetRoundPolicy, type RoundActionState } from "@/app/admin/rounds/actions";

const initial: RoundActionState = { status: "idle" };

/**
 * The re-attempt controls, deliberately separate from the main round form —
 * see adminSetRoundPolicy for why these aren't parameters on
 * admin_upsert_round.
 */
export function RoundPolicyForm({
  roundId,
  otherRounds,
  supersedesRoundId,
  isInviteOnly,
  quizExitPolicy,
  quizStrikeLimit,
}: {
  roundId: string;
  otherRounds: { id: string; title: string }[];
  supersedesRoundId: string | null;
  isInviteOnly: boolean;
  quizExitPolicy: "strict" | "lenient";
  quizStrikeLimit: number;
}) {
  const [state, action, pending] = useActionState(adminSetRoundPolicy, initial);

  return (
    <form action={action} className="space-y-4 rounded-xl border border-border bg-card p-4">
      <input type="hidden" name="roundId" value={roundId} />

      <div className="space-y-1.5">
        <Label htmlFor="supersedesRoundId">Replaces the score of</Label>
        <select
          id="supersedesRoundId"
          name="supersedesRoundId"
          defaultValue={supersedesRoundId ?? ""}
          className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="">— nothing (score counts on its own) —</option>
          {otherRounds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink-3">
          For any team with a score in this round, the selected round&apos;s score is ignored in the
          stage total — including when this one is lower. Both scores stay on record.
        </p>
      </div>

      <div className="flex items-start gap-2">
        <input
          id="isInviteOnly"
          name="isInviteOnly"
          type="checkbox"
          defaultChecked={isInviteOnly}
          className="mt-1 size-4 accent-gold"
        />
        <div>
          <Label htmlFor="isInviteOnly">Invite only</Label>
          <p className="text-xs text-ink-3">
            Only teams on the Eligibility list can see or start this round.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="quizExitPolicy">Exit policy</Label>
        <select
          id="quizExitPolicy"
          name="quizExitPolicy"
          defaultValue={quizExitPolicy}
          className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="strict">Strict — any exit signal submits immediately</option>
          <option value="lenient">Lenient — warn first, tab/minimise/navigate only</option>
        </select>
        <p className="text-xs text-ink-3">
          Lenient stops monitoring fullscreen entirely and lets a refresh resume the attempt, so a
          brightness change, notification shade or incoming call is harmless.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="quizStrikeLimit">Exits before auto-submit</Label>
        <Input
          id="quizStrikeLimit"
          name="quizStrikeLimit"
          type="number"
          min={1}
          max={5}
          defaultValue={quizStrikeLimit}
          className="max-w-24"
        />
        <p className="text-xs text-ink-3">
          Lenient only. 2 means: first exit shows a warning, second ends the attempt.
        </p>
        {state.fieldErrors?.quizStrikeLimit && (
          <p className="text-xs text-unsold">{state.fieldErrors.quizStrikeLimit[0]}</p>
        )}
      </div>

      {state.formError && <p className="text-sm text-unsold">{state.formError}</p>}
      {state.status === "success" && <p className="text-sm text-qualified">Saved.</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save round policy"}
      </Button>
    </form>
  );
}
