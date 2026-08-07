import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/bidwave";
import { RequestQueue } from "@/app/admin/auction/analytics-requests/request-queue";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Auction — Analytics Requests" };
export const dynamic = "force-dynamic";

/**
 * AN-01..08. Distinct from the operational dashboard at
 * /admin/auction/analytics — this page is purely about managing purchase
 * requests, not auction progress. Admin RLS (is_admin()) lets this query
 * see every team's requests directly through the session client.
 */
export default async function AdminAnalyticsRequestsPage() {
  const supabase = await createClient();

  const { data: edition } = await selectCurrentEdition(supabase);

  if (!edition) return <div className="p-10 text-ink-2">No active event edition.</div>;

  const { data: requests } = await supabase
    .from("analytics_requests")
    .select("*, teams(name)")
    .eq("event_edition_id", edition.id)
    .order("requested_at", { ascending: false });

  const rows = (requests ?? []).map((r) => ({
    id: r.id,
    team_id: r.team_id,
    team_name: (r as unknown as { teams: { name: string } | null }).teams?.name ?? "Unknown team",
    status: r.status,
    price_at_request: r.price_at_request,
    price_charged: r.price_charged,
    requested_at: r.requested_at,
    approved_at: r.approved_at,
    rejected_at: r.rejected_at,
    rejection_reason: r.rejection_reason,
  }));

  if (rows.length === 0) {
    return (
      <div className="p-10">
        <EmptyState
          title="No analytics requests yet"
          description="Requests appear here as soon as a shortlisted team asks to unlock analytics."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 p-6">
      <h1 className="font-display text-2xl">Analytics requests</h1>
      <RequestQueue rows={rows} eventEditionId={edition.id} />
    </div>
  );
}
