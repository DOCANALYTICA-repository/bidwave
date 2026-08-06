"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DataTable, StatusPill } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { RoundFormSheet } from "@/app/admin/rounds/round-form-sheet";
import { adminSetRoundLifecycle, adminReopenRound } from "@/app/admin/rounds/actions";
import type { Database } from "@/lib/supabase/types";

export type AdminRoundRow = Database["public"]["Views"]["rounds_with_status"]["Row"];

const LIFECYCLE_ACTIONS: { action: string; label: string }[] = [
  { action: "open_now", label: "Open now" },
  { action: "close_now", label: "Close now" },
  { action: "start_scoring", label: "Start scoring" },
  { action: "mark_scored", label: "Mark scored" },
  { action: "release_publicly", label: "Release publicly" },
];

function statusKey(status: string): "upcoming" | "open-eligible" | "closed" | "scored" {
  if (status === "draft" || status === "scheduled") return "upcoming";
  if (status === "open") return "open-eligible";
  if (status === "scored" || status === "publicly_released") return "scored";
  return "closed";
}

export function RoundsTable({
  rounds,
  stages,
}: {
  rounds: AdminRoundRow[];
  stages: { id: string; label: string }[];
}) {
  const [selected, setSelected] = useState<AdminRoundRow | "new" | null>(null);
  const [reopening, setReopening] = useState<AdminRoundRow | null>(null);
  const queryClient = useQueryClient();

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setSelected("new")}>New round</Button>
      </div>
      <DataTable<AdminRoundRow>
        rows={rounds}
        rowKey={(r) => r.id}
        emptyTitle="No rounds yet"
        emptyDescription="Create the first round to get started."
        columns={[
          {
            key: "title",
            header: "Round",
            render: (r) => (
              <div className="flex flex-col">
                <Link
                  href={`/admin/rounds/${r.id}`}
                  className="font-medium text-foreground hover:text-gold hover:underline"
                >
                  {r.title}
                </Link>
                <span className="text-xs text-ink-3">{r.slug}</span>
              </div>
            ),
          },
          { key: "kind", header: "Kind", render: (r) => r.kind },
          { key: "sequence", header: "#", render: (r) => r.sequence },
          { key: "status", header: "Status", render: (r) => <StatusPill status={statusKey(r.status)} label={r.status} /> },
          {
            key: "actions",
            header: "Actions",
            render: (r) => (
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="tile" onClick={() => setSelected(r)}>
                  Edit
                </Button>
                {LIFECYCLE_ACTIONS.map((a) => (
                  <Button
                    key={a.action}
                    size="sm"
                    variant="tile"
                    onClick={async () => {
                      const result = await adminSetRoundLifecycle(r.id, a.action);
                      if (result.status === "error") {
                        toast.error(result.formError ?? "Something went wrong.");
                      } else {
                        toast.success(`${a.label} — done.`);
                        // The 'rounds' broadcast_live() ping will also invalidate
                        // this, but don't wait on the realtime round-trip for the
                        // admin's own action.
                        queryClient.invalidateQueries({ queryKey: ["admin", "rounds"] });
                      }
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
                {r.closed_at && (
                  <Button size="sm" variant="tile" onClick={() => setReopening(r)}>
                    Reopen…
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <RoundFormSheet
        round={selected}
        stages={stages}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
      <ReopenDialog round={reopening} onOpenChange={(open) => !open && setReopening(null)} />
    </>
  );
}

// E1: reason-required, same friction as reverse-sale/reject-analytics —
// this is the one sanctioned way past rounds_no_reopen, so it shouldn't be
// a single frictionless click like the other lifecycle actions above.
function ReopenDialog({
  round,
  onOpenChange,
}: {
  round: AdminRoundRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  return (
    <Dialog open={!!round} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reopen round</DialogTitle>
          <DialogDescription>
            {round &&
              `"${round.title}" will reopen. If it was scored or released, that also resets — scoring/publish must be redone. Scores already entered are kept.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="reopen-reason">Reason (required)</Label>
          <Textarea
            id="reopen-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. closed the wrong round by mistake"
          />
        </div>

        {error && <p className="text-sm text-unsold">{error}</p>}

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={reason.trim().length === 0 || isPending || !round}
            onClick={async () => {
              if (!round) return;
              setIsPending(true);
              setError(null);
              const result = await adminReopenRound(round.id, reason.trim());
              setIsPending(false);
              if (result.status === "error") {
                setError(result.formError ?? "Something went wrong.");
                toast.error(result.formError ?? "Something went wrong.");
                return;
              }
              toast.success("Round reopened.");
              queryClient.invalidateQueries({ queryKey: ["admin", "rounds"] });
              setReason("");
              onOpenChange(false);
            }}
          >
            {isPending ? "Reopening…" : "Confirm reopen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
