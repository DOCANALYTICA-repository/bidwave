import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/bidwave";
import { LiveRealtime } from "@/app/(public)/live/live-realtime";
import { selectCurrentEdition } from "@/lib/event-edition";
import { getSettingsForEdition } from "@/lib/supabase/settings";

export const metadata: Metadata = { title: "Live Auction" };
export const dynamic = "force-dynamic";

/**
 * PUB-05/06, LIVE-01..08. Deliberately reduced to one thing: the running
 * sale log, as "<player> sold to <franchise>".
 *
 * Everything else that used to live here — the on-the-block hero, per-team
 * squad boards with purse balances, the full player-pool grid, and the
 * analytics purchased/locked badges — is gone by explicit request. The
 * queries behind them were removed too, not just their markup, so nothing
 * unshown is still being shipped to the browser.
 *
 * Teams are named by their assigned IPL franchise alias. A team with no
 * assignment yet falls back to its registered name, since a sale line with a
 * blank buyer would be worse than one naming the team.
 */
export default async function LivePage() {
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);

  if (!edition) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <h1 className="font-display text-4xl">Live Auction</h1>
        <EmptyState
          title="Coverage hasn't started yet"
          description="Live auction coverage begins during Round 5 (Day 2, 18–19 August 2026)."
        />
      </div>
    );
  }

  const [{ data: sales }, settings] = await Promise.all([
    // public_sales_feed carries no event_edition_id column to filter on; in
    // practice only the live edition has sales, and the alternative is a
    // migration to widen the view.
    supabase
      .from("public_sales_feed")
      .select("id, player_name, team_id, team_name, sold_at, reversed_at")
      .order("sold_at", { ascending: false }),
    getSettingsForEdition(edition.id, ["auction_franchise_assignments"]),
  ]);

  const franchises = settings.auction_franchise_assignments ?? {};
  const rows = sales ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <LiveRealtime eventEditionId={edition.id} />

      <div className="text-center">
        <h1 className="font-display text-4xl">Live Auction</h1>
        <p className="mt-1 text-sm text-ink-2">Sale log</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No sales yet"
          description="Sales appear here as lots are knocked down."
        />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((s) => {
            const buyer = franchises[s.team_id as string] ?? s.team_name;
            return (
              <li
                key={s.id}
                className={`rounded-lg border border-border bg-card px-4 py-2.5 text-sm ${
                  s.reversed_at ? "text-ink-3" : ""
                }`}
              >
                <span className={s.reversed_at ? "line-through" : ""}>
                  <span className="font-medium">{s.player_name}</span>
                  <span className="text-ink-2"> sold to </span>
                  <span className="font-heading uppercase tracking-wide text-gold">{buyer}</span>
                </span>
                {s.reversed_at && <span className="ml-2 text-xs text-unsold">reversed</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
