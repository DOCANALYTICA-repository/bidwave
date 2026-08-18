"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/bidwave";
import { AUCTION_FRANCHISES, type ParticipantFieldVisibility } from "@/lib/validation/auction";
import {
  adminSaveFranchiseAssignments,
  adminSaveParticipantVisibility,
  type AuctionSetupData,
  type SetupActionState,
} from "@/app/admin/auction/setup/actions";

// useActionState's initial value has to be declared in the client file, not
// the "use server" module — same note as players-table.tsx:23-25.
const initialState: SetupActionState = { status: "idle" };

const UNASSIGNED = "__unassigned__";

export function AuctionSetupForm({ data }: { data: AuctionSetupData }) {
  return (
    <div className="space-y-12">
      <FranchiseSection data={data} />
      <VisibilitySection initial={data.visibility} />
    </div>
  );
}

/**
 * Franchise-first rows: exactly 12 identities, each picking one team. That
 * matches the real-world shape ("who is Chennai this year?") and makes the
 * 12-team cap structural rather than something the admin has to count.
 */
function FranchiseSection({ data }: { data: AuctionSetupData }) {
  const [state, formAction, isPending] = useActionState(adminSaveFranchiseAssignments, initialState);

  // Stored as team -> franchise; the UI needs the inverse.
  const [byFranchise, setByFranchise] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [teamId, franchise] of Object.entries(data.assignments)) initial[franchise] = teamId;
    return initial;
  });

  useEffect(() => {
    if (state.status === "success") toast.success("Franchise assignments saved.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state]);

  const pairs = AUCTION_FRANCHISES.map((franchise) => ({
    franchise,
    teamId: byFranchise[franchise] ?? "",
  }));
  const assignedCount = pairs.filter((p) => p.teamId).length;

  // A team already seated elsewhere is shown but disabled, so the clash is
  // visible before the server rejects it.
  const takenBy = new Map<string, string>();
  for (const p of pairs) if (p.teamId) takenBy.set(p.teamId, p.franchise);

  const teamName = (id: string) => data.teams.find((t) => t.id === id)?.name ?? "Unknown team";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="pairs" value={JSON.stringify(pairs)} />

      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          Franchise identities
        </h2>
        <span className="font-mono text-xs text-ink-3">{assignedCount} / 12 seated</span>
      </div>

      <p className="text-xs text-ink-2">
        Assign each franchise to one qualified team. Teams marked{" "}
        <span className="text-sold">qualified</span> have advanced a stage; others are still
        selectable in case stage decisions have not been recorded yet.
      </p>

      <div className="space-y-2">
        {AUCTION_FRANCHISES.map((franchise) => {
          const current = byFranchise[franchise] ?? "";
          return (
            <div
              key={franchise}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="font-heading text-sm font-medium">{franchise}</span>
              <Select
                value={current || UNASSIGNED}
                onValueChange={(next) =>
                  setByFranchise((prev) => ({
                    ...prev,
                    [franchise]: !next || next === UNASSIGNED ? "" : next,
                  }))
                }
              >
                <SelectTrigger className="w-full sm:w-80">
                  <SelectValue>
                    {() => (current ? teamName(current) : "— Unassigned —")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>— Unassigned —</SelectItem>
                  {data.teams.map((t) => {
                    const heldBy = takenBy.get(t.id);
                    const blocked = !!heldBy && heldBy !== franchise;
                    return (
                      <SelectItem key={t.id} value={t.id} disabled={blocked}>
                        {t.name}
                        {t.qualified ? " ✓" : ""}
                        {blocked ? ` — ${heldBy}` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save franchise assignments"}
      </Button>
    </form>
  );
}

/**
 * Progressive reveal of player fields. Name, nationality and pool are always
 * visible — without them the catalogue is unusable — so they are shown as
 * fixed rows rather than toggles. Player statistics are intentionally absent:
 * they stay behind the paid analytics unlock (AN-01..08).
 */
function VisibilitySection({ initial }: { initial: ParticipantFieldVisibility }) {
  const [state, formAction, isPending] = useActionState(adminSaveParticipantVisibility, initialState);

  useEffect(() => {
    if (state.status === "success") toast.success("Participant visibility updated.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state]);

  const toggles: { name: keyof ParticipantFieldVisibility; label: string; hint: string }[] = [
    { name: "role", label: "Role", hint: "Batter / Bowler / All rounder / Wicket keeper" },
    { name: "base_price", label: "Base price", hint: "The opening price for each lot" },
    { name: "ipl_team", label: "Previous IPL team", hint: "Prior franchise, informational" },
  ];

  return (
    <form action={formAction} className="space-y-4">
      <div className="border-b border-border pb-2">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          Participant visibility
        </h2>
      </div>

      <p className="text-xs text-ink-2">
        Controls what teams see in the player list. Applied on the server — hidden fields are never
        sent to the browser, not merely hidden in the page.
      </p>

      <div className="space-y-2">
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs text-ink-2">
          Always visible: <span className="text-foreground">player name</span>,{" "}
          <span className="text-foreground">nationality</span>,{" "}
          <span className="text-foreground">pool</span> and live{" "}
          <span className="text-foreground">status</span>.
        </div>

        {toggles.map((t) => (
          <label
            key={t.name}
            className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3"
          >
            <span>
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="block text-xs text-ink-3">{t.hint}</span>
            </span>
            <input
              type="checkbox"
              name={t.name}
              defaultChecked={initial[t.name]}
              className="size-4 shrink-0 accent-[var(--gold)]"
            />
          </label>
        ))}

        <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed border-border px-4 py-3">
          <span>
            <span className="block text-sm font-medium text-ink-2">Player statistics</span>
            <span className="block text-xs text-ink-3">
              Not toggleable — sold separately through the analytics unlock.
            </span>
          </span>
          <StatusPill status="locked" />
        </div>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save visibility"}
      </Button>
    </form>
  );
}
