import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { StatTile, Money } from "@/components/bidwave";

export const metadata: Metadata = { title: "Auction — Analytics" };
export const dynamic = "force-dynamic";

/**
 * The admin's own operational dashboard — distinct from the team-facing
 * locked stub at /app/auction/analytics. Fully in Phase 6 scope, not
 * gated on Phase 7.
 */
export default async function AdminAuctionAnalyticsPage() {
  const supabase = await createClient();

  const { data: edition } = await supabase
    .from("event_editions")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  if (!edition) return <div className="p-10 text-ink-2">No active event edition.</div>;

  const [{ data: players }, { data: purses }, { data: auditEvents }] = await Promise.all([
    supabase.from("players").select("status, pool, role, is_overseas").eq("event_edition_id", edition.id),
    supabase.from("public_team_purses").select("*").eq("event_edition_id", edition.id).order("purse_balance"),
    supabase
      .from("auction_audit_events")
      .select("id, kind, created_at, detail")
      .eq("event_edition_id", edition.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const counts = (players ?? []).reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <h1 className="font-display text-2xl">Auction — Analytics</h1>

      <div className="grid gap-4 sm:grid-cols-5">
        <StatTile label="Available" value={counts.available ?? 0} />
        <StatTile label="Active" value={counts.active ?? 0} tone="gold" />
        <StatTile label="Sold" value={counts.sold ?? 0} tone="success" />
        <StatTile label="Unsold" value={counts.unsold ?? 0} tone="danger" />
        <StatTile label="Recalled" value={counts.recalled ?? 0} />
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          Purse remaining per team
        </h2>
        <div className="space-y-2">
          {(purses ?? []).map((t) => (
            <div key={t.team_id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2">
              <span className="text-sm font-medium">{t.name}</span>
              <Money value={t.purse_balance ?? 0} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          Recent audit events
        </h2>
        <ul className="space-y-1 text-sm text-ink-2">
          {(auditEvents ?? []).map((e) => (
            <li key={e.id}>
              <span className="font-mono text-xs text-ink-3">
                {new Date(e.created_at).toLocaleTimeString()}
              </span>{" "}
              {e.kind}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
