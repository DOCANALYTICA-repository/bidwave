"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable, type DataTableColumn, Money, ReconnectBanner, StatusPill } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";
import {
  approveAnalyticsRequest,
  rejectAnalyticsRequest,
  revokeAnalyticsApproval,
} from "@/app/admin/auction/analytics-requests/actions";

type RequestRow = {
  id: string;
  team_id: string;
  team_name: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  price_at_request: number;
  price_charged: number | null;
  requested_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
};

// Any server-rendered toLocaleString call needs an explicit locale/options
// — a zero-arg call produced a real hydration mismatch elsewhere in this
// codebase (console-sales-log.tsx).
function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    hour12: false,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RequestQueue({ rows, eventEditionId }: { rows: RequestRow[]; eventEditionId: string }) {
  const router = useRouter();
  const { status } = useLiveBroadcast(eventEditionId, "analytics", () => router.refresh());
  const [rejecting, setRejecting] = useState<RequestRow | null>(null);
  const [revoking, setRevoking] = useState<RequestRow | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  const columns = (showActions: boolean): DataTableColumn<RequestRow>[] => [
    { key: "team", header: "Team", render: (r) => r.team_name },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusPill
          status={
            r.status === "approved"
              ? "purchased"
              : r.status === "pending"
                ? "requested"
                : "rejected"
          }
          label={r.status}
        />
      ),
    },
    { key: "price", header: "Price", render: (r) => <Money value={r.price_charged ?? r.price_at_request} /> },
    { key: "requested", header: "Requested", render: (r) => formatTimestamp(r.requested_at) },
    {
      key: "detail",
      header: "Detail",
      render: (r) =>
        r.status === "rejected" ? (
          <span className="text-xs text-ink-3">{r.rejection_reason}</span>
        ) : r.status === "approved" ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-3">{r.approved_at ? formatTimestamp(r.approved_at) : ""}</span>
            <Button size="sm" variant="tile" onClick={() => setRevoking(r)}>
              Revoke…
            </Button>
          </div>
        ) : null,
    },
    ...(showActions
      ? [
          {
            key: "actions",
            header: "",
            render: (r: RequestRow) => (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={approvingId === r.id}
                  onClick={async () => {
                    setApprovingId(r.id);
                    setApproveError(null);
                    const result = await approveAnalyticsRequest(r.id);
                    setApprovingId(null);
                    if (result.error) {
                      setApproveError(result.error);
                      toast.error(result.error);
                      return;
                    }
                    toast.success("Analytics request approved.");
                    router.refresh();
                  }}
                >
                  {approvingId === r.id ? "Approving…" : "Approve"}
                </Button>
                <Button variant="tile" size="sm" onClick={() => setRejecting(r)}>
                  Reject…
                </Button>
              </div>
            ),
          } satisfies DataTableColumn<RequestRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-8">
      <ReconnectBanner status={status} />

      <div className="space-y-3">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          Pending ({pending.length})
        </h2>
        {approveError && <p className="text-sm text-unsold">{approveError}</p>}
        <DataTable
          columns={columns(true)}
          rows={pending}
          rowKey={(r) => r.id}
          emptyTitle="No pending requests"
        />
      </div>

      <div className="space-y-3">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-ink-2">History</h2>
        <DataTable columns={columns(false)} rows={decided} rowKey={(r) => r.id} emptyTitle="No decided requests yet" />
      </div>

      <RejectDialog request={rejecting} onOpenChange={(open) => !open && setRejecting(null)} />
      <RevokeDialog request={revoking} onOpenChange={(open) => !open && setRevoking(null)} />
    </div>
  );
}

// E4: the one previously-missing correction path — an approved request was
// terminal. Same reason-required friction as reject/reverse-sale.
function RevokeDialog({
  request,
  onOpenChange,
}: {
  request: RequestRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke analytics approval</DialogTitle>
          <DialogDescription>
            {request &&
              `${request.team_name}'s analytics access will be revoked and ${
                request.price_charged != null ? `their purse refunded ${request.price_charged}.` : "nothing was charged."
              }`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="revoke-reason">Reason (required)</Label>
          <Textarea
            id="revoke-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. approved by mistake"
          />
        </div>

        {error && <p className="text-sm text-unsold">{error}</p>}

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={reason.trim().length === 0 || isPending || !request}
            onClick={async () => {
              if (!request) return;
              setIsPending(true);
              setError(null);
              const result = await revokeAnalyticsApproval(request.id, reason.trim());
              setIsPending(false);
              if (result.error) {
                setError(result.error);
                toast.error(result.error);
                return;
              }
              toast.success("Analytics approval revoked.");
              setReason("");
              onOpenChange(false);
              router.refresh();
            }}
          >
            {isPending ? "Revoking…" : "Confirm revoke"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The one deliberate friction point (mirrors console-sales-log.tsx's
// reversal dialog): a reason is required before the confirm button enables.
function RejectDialog({
  request,
  onOpenChange,
}: {
  request: RequestRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject analytics request</DialogTitle>
          <DialogDescription>
            {request && `${request.team_name}'s request will be marked rejected. Nothing has been charged yet.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="rejection-reason">Reason (required)</Label>
          <Textarea
            id="rejection-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. team not shortlisted"
          />
        </div>

        {error && <p className="text-sm text-unsold">{error}</p>}

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={reason.trim().length === 0 || isPending || !request}
            onClick={async () => {
              if (!request) return;
              setIsPending(true);
              setError(null);
              const result = await rejectAnalyticsRequest(request.id, reason.trim());
              setIsPending(false);
              if (result.error) {
                setError(result.error);
                toast.error(result.error);
                return;
              }
              toast.success("Analytics request rejected.");
              setReason("");
              onOpenChange(false);
              router.refresh();
            }}
          >
            {isPending ? "Rejecting…" : "Confirm rejection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
