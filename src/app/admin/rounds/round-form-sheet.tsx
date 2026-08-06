"use client";

import { useActionState, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROUND_KINDS } from "@/lib/validation/rounds";
import { adminSaveRound, type RoundActionState } from "@/app/admin/rounds/actions";

// "use server" files can only export async functions — the initial state
// literal has to live here on the client side (same convention as
// team-detail-sheet.tsx's adminTeamActionInitialState).
const roundActionInitialState: RoundActionState = { status: "idle" };
import type { AdminRoundRow } from "@/app/admin/rounds/rounds-table";

export function RoundFormSheet({
  round,
  onOpenChange,
  stages,
}: {
  round: AdminRoundRow | "new" | null;
  onOpenChange: (open: boolean) => void;
  stages: { id: string; label: string }[];
}) {
  return (
    <Sheet open={!!round} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        {round && (
          <RoundFormContent
            key={round === "new" ? "new" : round.id}
            round={round === "new" ? null : round}
            stages={stages}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function toDatetimeLocal(value: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 16);
}

function RoundFormContent({
  round,
  stages,
}: {
  round: AdminRoundRow | null;
  stages: { id: string; label: string }[];
}) {
  const [kind, setKind] = useState(round?.kind ?? "submission");
  const [rubricTotalMode, setRubricTotalMode] = useState(round?.rubric_total_mode ?? "weighted_sum");
  const [requiresStage, setRequiresStage] = useState(round?.requires_qualification_from_stage ?? "");
  const [state, formAction, isPending] = useActionState(adminSaveRound, roundActionInitialState);
  const queryClient = useQueryClient();

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.status === "success") {
      toast.success("Round saved.");
      queryClient.invalidateQueries({ queryKey: ["admin", "rounds"] });
    }
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{round ? round.title : "New round"}</SheetTitle>
        <SheetDescription>ADM-03: round builder — schedule, kind and scoring format.</SheetDescription>
      </SheetHeader>

      <form action={formAction} className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <input type="hidden" name="roundId" value={round?.id ?? ""} />
        <input type="hidden" name="expectedUpdatedAt" value={round?.updated_at ?? ""} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="rubricTotalMode" value={rubricTotalMode} />
        <input type="hidden" name="requiresQualificationFromStage" value={requiresStage} />

        <div className="space-y-1.5">
          <Label htmlFor="round-title">Title</Label>
          <Input id="round-title" name="title" defaultValue={round?.title} required />
          {state.fieldErrors?.title?.map((m) => (
            <p key={m} className="text-xs text-unsold">{m}</p>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="round-slug">Slug</Label>
            <Input id="round-slug" name="slug" defaultValue={round?.slug} required />
            {state.fieldErrors?.slug?.map((m) => (
              <p key={m} className="text-xs text-unsold">{m}</p>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="round-sequence">Sequence</Label>
            <Input id="round-sequence" name="sequence" type="number" min={1} defaultValue={round?.sequence ?? 1} required />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="round-kind">Kind</Label>
          <Select value={kind} onValueChange={(v) => v && setKind(v as typeof kind)}>
            <SelectTrigger id="round-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROUND_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="round-brief">Brief</Label>
          <Textarea id="round-brief" name="brief" defaultValue={round?.brief ?? ""} rows={3} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="round-instructions">Instructions</Label>
          <Textarea id="round-instructions" name="instructions" defaultValue={round?.instructions ?? ""} rows={3} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="round-opens">Opens</Label>
            <Input
              id="round-opens"
              name="opensAt"
              type="datetime-local"
              defaultValue={toDatetimeLocal(round?.opens_at ?? null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="round-closes">Closes</Label>
            <Input
              id="round-closes"
              name="closesAt"
              type="datetime-local"
              defaultValue={toDatetimeLocal(round?.closes_at ?? null)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="round-requires-stage">Requires qualification from</Label>
          <Select
            value={requiresStage || "none"}
            onValueChange={(v) => setRequiresStage(v === "none" || !v ? "" : v)}
          >
            <SelectTrigger id="round-requires-stage" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None — open to all registered teams</SelectItem>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(kind === "submission" || kind === "offline_info") && (
          <div className="space-y-1.5">
            <Label htmlFor="round-rubric-mode">Rubric total mode</Label>
            <Select value={rubricTotalMode} onValueChange={(v) => v && setRubricTotalMode(v as typeof rubricTotalMode)}>
              <SelectTrigger id="round-rubric-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weighted_sum">Weighted sum</SelectItem>
                <SelectItem value="weighted_percent">Weighted percent of max</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {state.status === "error" && state.formError && (
          <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
            {state.formError}
          </p>
        )}
        {state.status === "success" && (
          <p className="rounded-lg border border-sold/30 bg-sold/10 px-3 py-2 text-sm text-sold">Saved.</p>
        )}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Saving…" : "Save round"}
        </Button>
      </form>
      <SheetFooter />
    </>
  );
}
