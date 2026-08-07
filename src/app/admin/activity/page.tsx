import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ActivityLog, type ActivityRow, type AuditRow } from "@/app/admin/activity/activity-log";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

/**
 * ADM-13: in-app review of login/submission activity and the auction
 * audit trail. Was previously CSV/XLSX-only via /admin/exports (REP-06/07,
 * still the source of truth for offline records) — this page is a live
 * on-screen complement, not a replacement.
 */
export default async function AdminActivityPage() {
  const supabase = await createClient();

  const { data: edition } = await selectCurrentEdition(supabase);

  if (!edition) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
        <h1 className="font-display text-2xl">Activity</h1>
        <p className="text-sm text-ink-2">No active event edition.</p>
      </div>
    );
  }

  const [{ data: activity }, { data: audit }, { data: teams }, { data: players }] = await Promise.all([
    supabase
      .from("activity_events")
      .select("id, created_at, actor_role, kind, team_id, detail")
      .eq("event_edition_id", edition.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("auction_audit_events")
      .select("id, created_at, kind, player_id, team_id, sale_id, actor_id, detail")
      .eq("event_edition_id", edition.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("teams").select("id, name").eq("event_edition_id", edition.id),
    supabase.from("players").select("id, full_name").eq("event_edition_id", edition.id),
  ]);

  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.full_name]));

  const activityRows: ActivityRow[] = (activity ?? []).map((e) => ({
    id: e.id,
    created_at: e.created_at,
    actor_role: e.actor_role,
    kind: e.kind,
    team_name: e.team_id ? (teamNameById.get(e.team_id) ?? e.team_id) : null,
    detail: e.detail as Record<string, unknown>,
  }));

  const auditRows: AuditRow[] = (audit ?? []).map((e) => ({
    id: e.id,
    created_at: e.created_at,
    kind: e.kind,
    team_name: e.team_id ? (teamNameById.get(e.team_id) ?? e.team_id) : null,
    player_name: e.player_id ? (playerNameById.get(e.player_id) ?? e.player_id) : null,
    detail: e.detail as Record<string, unknown>,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Activity</h1>
        <p className="text-sm text-ink-2">
          ADM-13: review login/submission activity and the auction audit trail. Full records
          remain downloadable from <Link href="/admin/exports" className="text-gold hover:underline">Exports</Link>.
        </p>
      </div>

      <ActivityLog activity={activityRows} audit={auditRows} eventEditionId={edition.id} />
    </div>
  );
}
