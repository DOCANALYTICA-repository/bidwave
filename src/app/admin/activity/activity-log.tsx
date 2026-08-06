"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn, ReconnectBanner } from "@/components/bidwave";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";

export type ActivityRow = {
  id: string;
  created_at: string;
  actor_role: string;
  kind: string;
  team_name: string | null;
  detail: Record<string, unknown>;
};

export type AuditRow = {
  id: string;
  created_at: string;
  kind: string;
  team_name: string | null;
  player_name: string | null;
  detail: Record<string, unknown>;
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
    second: "2-digit",
  });
}

function detailSummary(detail: Record<string, unknown>) {
  const entries = Object.entries(detail ?? {});
  if (entries.length === 0) return "—";
  return entries.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
}

export function ActivityLog({
  activity,
  audit,
  eventEditionId,
}: {
  activity: ActivityRow[];
  audit: AuditRow[];
  eventEditionId: string;
}) {
  const router = useRouter();
  const [activitySearch, setActivitySearch] = useState("");
  const [auditSearch, setAuditSearch] = useState("");

  // Auction sale/reversal/import/etc. functions already call broadcast_live
  // with topic 'auction' alongside their auction_audit_events insert, so
  // this section gets live updates for free. activity_events (logins/
  // submissions) has no equivalent broadcast wired up — a manual refresh
  // button below covers that instead, rather than adding a new broadcast
  // topic just for this page.
  const { status } = useLiveBroadcast(eventEditionId, "auction", () => router.refresh());

  const filteredActivity = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    if (!q) return activity;
    return activity.filter(
      (r) =>
        r.kind.toLowerCase().includes(q) ||
        r.actor_role.toLowerCase().includes(q) ||
        (r.team_name?.toLowerCase().includes(q) ?? false),
    );
  }, [activity, activitySearch]);

  const filteredAudit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return audit;
    return audit.filter(
      (r) =>
        r.kind.toLowerCase().includes(q) ||
        (r.team_name?.toLowerCase().includes(q) ?? false) ||
        (r.player_name?.toLowerCase().includes(q) ?? false),
    );
  }, [audit, auditSearch]);

  const activityColumns: DataTableColumn<ActivityRow>[] = [
    { key: "time", header: "Time", render: (r) => formatTimestamp(r.created_at) },
    { key: "actor", header: "Actor", render: (r) => r.actor_role },
    { key: "kind", header: "Event", render: (r) => r.kind },
    { key: "team", header: "Team", render: (r) => r.team_name ?? "—" },
    { key: "detail", header: "Detail", render: (r) => <span className="text-xs text-ink-3">{detailSummary(r.detail)}</span> },
  ];

  const auditColumns: DataTableColumn<AuditRow>[] = [
    { key: "time", header: "Time", render: (r) => formatTimestamp(r.created_at) },
    { key: "kind", header: "Event", render: (r) => r.kind },
    { key: "team", header: "Team", render: (r) => r.team_name ?? "—" },
    { key: "player", header: "Player", render: (r) => r.player_name ?? "—" },
    { key: "detail", header: "Detail", render: (r) => <span className="text-xs text-ink-3">{detailSummary(r.detail)}</span> },
  ];

  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
            Auction audit log
          </h2>
        </div>
        <ReconnectBanner status={status} />
        <Input
          placeholder="Search by event, team or player…"
          value={auditSearch}
          onChange={(e) => setAuditSearch(e.target.value)}
        />
        <DataTable
          columns={auditColumns}
          rows={filteredAudit}
          rowKey={(r) => r.id}
          emptyTitle="No auction audit events yet"
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-ink-2">
            Login &amp; submission activity
          </h2>
          <Button variant="tile" size="sm" onClick={() => router.refresh()}>
            Refresh
          </Button>
        </div>
        <p className="text-xs text-ink-3">Not live — use Refresh for the latest.</p>
        <Input
          placeholder="Search by event, actor or team…"
          value={activitySearch}
          onChange={(e) => setActivitySearch(e.target.value)}
        />
        <DataTable
          columns={activityColumns}
          rows={filteredActivity}
          rowKey={(r) => r.id}
          emptyTitle="No activity events yet"
        />
      </div>
    </div>
  );
}
