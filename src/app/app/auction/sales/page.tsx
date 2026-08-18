import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BackLink, EmptyState, Money, StatTile } from "@/components/bidwave";
import { TeamAuctionRealtime } from "@/app/app/auction/team-auction-realtime";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Sale log" };
export const dynamic = "force-dynamic";

/**
 * The running sale log as participants see it: which player went, and for how
 * much — but never which team bought them. The buying team is the one piece
 * of information that would let a team reverse-engineer rivals' remaining
 * purse and squad shape from this page alone, so `team_id`/`team_name` are
 * left out of the select entirely rather than hidden in the markup.
 *
 * (public_sales_feed does expose team_name — the public /live tracker uses it
 * for the franchise squad boards. This page deliberately reads a narrower
 * slice of the same view.)
 *
 * Reversed sales are shown struck through rather than dropped: a lot that was
 * recorded and then reversed is public knowledge in the room, and silently
 * removing it would make the log disagree with what everyone just watched.
 */
export default async function TeamSaleLogPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return <div className="p-10 text-ink-2">No active event edition.</div>;

  const { data: sales } = await supabase
    .from("public_sales_feed")
    .select("id, player_name, role, pool, amount, sold_at, reversed_at")
    .order("sold_at", { ascending: false });

  const rows = sales ?? [];
  const live = rows.filter((s) => !s.reversed_at);
  const totalSpend = live.reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
  const highest = live.reduce((max, s) => Math.max(max, Number(s.amount ?? 0)), 0);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-12">
      <TeamAuctionRealtime eventEditionId={edition.id} />

      <div className="space-y-2">
        <BackLink href="/app/auction" label="Back to your squad" />
        <h1 className="font-display text-3xl">Sale log</h1>
        <p className="text-sm text-ink-2">
          Every lot sold so far and the price it fetched. Buying teams are not shown.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Lots sold" value={live.length} />
        <StatTile label="Total spend" value={<Money value={totalSpend} />} tone="gold" />
        <StatTile label="Highest price" value={<Money value={highest} />} tone="gold" />
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          Most recent first
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            title="No sales yet"
            description="Sales appear here in real time as lots are knocked down."
          />
        ) : (
          <ul className="space-y-1.5">
            {rows.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className={s.reversed_at ? "line-through text-ink-3" : "font-medium"}>
                    {s.player_name}
                  </span>
                  <span className="ml-2 text-xs text-ink-3">
                    {[s.role, s.pool].filter(Boolean).join(" · ")}
                  </span>
                  {s.reversed_at && (
                    <span className="ml-2 text-xs text-unsold">reversed</span>
                  )}
                </span>
                <Money
                  value={Number(s.amount ?? 0)}
                  className={s.reversed_at ? "text-ink-3 line-through" : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
