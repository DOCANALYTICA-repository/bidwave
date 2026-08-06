"use client";

import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";
import type { WizardValues } from "@/app/register/wizard-types";

export function ReviewStep({
  values,
  formError,
  isPending,
  onSubmit,
}: {
  values: WizardValues;
  formError?: string;
  isPending: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">Team</p>
          <p className="font-heading text-base">{values.teamName || "—"}</p>
          <p className="text-ink-2">{values.campus || "—"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">Members</p>
          <ul className="mt-1 space-y-1">
            {values.members.map((m, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {m.isCaptain && <Crown className="size-3.5 text-gold" />}
                <span>{m.fullName || "—"}</span>
                <span className="text-ink-3">· {m.registerNumber || "—"}</span>
                <span className="text-ink-3">· {m.christEmail || "—"}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">Payment proof</p>
          <p>{values.invoiceFile?.name ?? "No file attached"}</p>
        </div>
      </div>

      {formError && (
        <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
          {formError}
        </p>
      )}

      <Button onClick={onSubmit} disabled={isPending} className="w-full">
        {isPending ? "Submitting…" : "Complete registration"}
      </Button>
    </div>
  );
}
