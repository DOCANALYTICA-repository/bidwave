import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, StatusPill } from "@/components/bidwave";
import { RequestAnalyticsForm } from "@/app/app/auction/analytics/request-analytics-form";
import { AnalyticsModule } from "@/app/app/auction/analytics/analytics-module";
import { AnalyticsRealtime } from "@/app/app/auction/analytics/analytics-realtime";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

/**
 * TEAM-AUC-06/AN-01..08. Branches on the team's latest analytics_requests
 * row: none -> Locked + price + request; pending -> Requested; rejected ->
 * reason + re-request; approved -> the real module, permanently.
 */
export default async function TeamAuctionAnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return <div className="p-10 text-ink-2">No active event edition.</div>;

  const [{ data: latestRequest }, { data: ruleSet }, { data: balanceRow }] = await Promise.all([
    supabase
      .from("analytics_requests")
      .select("*")
      .eq("team_id", user.id)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("auction_rule_sets")
      .select("analytics_price, min_squad_size, max_squad_size, max_overseas, role_limits, pool_limits")
      .eq("event_edition_id", edition.id)
      .eq("is_active", true)
      .maybeSingle(),
    supabase.from("team_purse_balances").select("balance").eq("team_id", user.id).maybeSingle(),
  ]);

  const balance = balanceRow?.balance ?? 0;
  const price = ruleSet?.analytics_price ?? 0;

  if (latestRequest?.status === "approved") {
    const [{ data: roster }, { data: availablePlayers }, { data: statDefs }] = await Promise.all([
      supabase
        .from("players")
        .select("id, full_name, role, pool, base_price, status, is_overseas, current_team_id, stats")
        .eq("current_team_id", user.id)
        .eq("status", "sold"),
      supabase
        .from("players")
        .select("id, full_name, role, pool, base_price, status, is_overseas, current_team_id, stats")
        .eq("event_edition_id", edition.id)
        .eq("status", "available"),
      supabase
        .from("player_stat_definitions")
        .select("key, label, data_type")
        .eq("event_edition_id", edition.id)
        .order("position"),
    ]);

    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <AnalyticsRealtime eventEditionId={edition.id} />
        <AnalyticsModule
          roster={(roster ?? []) as never}
          availablePlayers={(availablePlayers ?? []) as never}
          ruleSet={(ruleSet ?? null) as never}
          balance={balance}
          statDefs={statDefs ?? []}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-12 text-center">
      <AnalyticsRealtime eventEditionId={edition.id} />

      {latestRequest?.status === "pending" && (
        <>
          <StatusPill status="requested" />
          <EmptyState
            title="Request pending"
            description="Your admin will review this shortly — this page updates automatically once decided."
          />
        </>
      )}

      {latestRequest?.status === "rejected" && (
        <>
          <StatusPill status="rejected" />
          <EmptyState
            title="Request rejected"
            description={latestRequest.rejection_reason ?? "Contact your admin for details."}
          />
          <RequestAnalyticsForm price={price} balance={balance} />
        </>
      )}

      {!latestRequest && (
        <>
          <StatusPill status="locked" />
          <EmptyState
            title="Analytics locked"
            description="Unlocks after an approved purchase from your purse. Ask your admin about pricing and availability."
          />
          <RequestAnalyticsForm price={price} balance={balance} />
        </>
      )}
    </div>
  );
}
