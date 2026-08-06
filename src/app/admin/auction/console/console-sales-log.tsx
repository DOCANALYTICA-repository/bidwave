"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable, type DataTableColumn, Money } from "@/components/bidwave";
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
import { reverseSale } from "@/app/admin/auction/console/actions";

type SaleRow = {
  id: string;
  player_id: string;
  player_name: string;
  player_updated_at: string;
  team_id: string | null;
  team_name: string;
  amount: number;
  sold_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
};

export function ConsoleSalesLog({ sales }: { sales: SaleRow[] }) {
  const [reversing, setReversing] = useState<SaleRow | null>(null);

  const columns: DataTableColumn<SaleRow>[] = [
    { key: "player", header: "Player", render: (s) => s.player_name },
    { key: "team", header: "Team", render: (s) => s.team_name },
    { key: "amount", header: "Amount", render: (s) => <Money value={s.amount} /> },
    {
      key: "when",
      header: "When",
      // toLocaleTimeString() with no explicit locale/options renders
      // differently server (Node's default locale) vs. client (the
      // browser's), causing a hydration mismatch — pin both to the same
      // fixed format instead.
      render: (s) =>
        new Date(s.sold_at).toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    },
    {
      key: "status",
      header: "Status",
      render: (s) =>
        s.reversed_at ? (
          <span className="text-unsold">Reversed{s.reversal_reason ? ` — ${s.reversal_reason}` : ""}</span>
        ) : (
          <span className="text-sold">Sold</span>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (s) =>
        !s.reversed_at && (
          <Button variant="tile" size="sm" onClick={() => setReversing(s)}>
            Reverse…
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">Recent sales</h2>
      <DataTable
        columns={columns}
        rows={sales}
        rowKey={(s) => s.id}
        emptyTitle="No sales yet"
        emptyDescription="Recorded sales appear here in real time."
      />

      <ReversalDialog sale={reversing} onOpenChange={(open) => !open && setReversing(null)} />
    </div>
  );
}

// §24.4: the one deliberate friction point — reversal requires an explicit
// reason before the confirm button enables, matching "make destructive/
// corrective admin actions explicit" while sale entry itself stays
// frictionless.
function ReversalDialog({
  sale,
  onOpenChange,
}: {
  sale: SaleRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={!!sale} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse sale</DialogTitle>
          <DialogDescription>
            {sale && `${sale.player_name} → ${sale.team_name} for `}
            {sale && <Money value={sale.amount} />}. This restores the player and refunds the purse.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="reversal-reason">Reason (required)</Label>
          <Textarea
            id="reversal-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. entered wrong amount"
          />
        </div>

        {error && <p className="text-sm text-unsold">{error}</p>}

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={reason.trim().length === 0 || isPending || !sale}
            onClick={async () => {
              if (!sale) return;
              setIsPending(true);
              setError(null);
              const result = await reverseSale(sale.id, reason.trim(), sale.player_updated_at);
              setIsPending(false);
              if (result.error) {
                setError(result.error);
                toast.error(result.error);
                return;
              }
              toast.success("Sale reversed.");
              setReason("");
              onOpenChange(false);
              router.refresh();
            }}
          >
            {isPending ? "Reversing…" : "Confirm reversal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
