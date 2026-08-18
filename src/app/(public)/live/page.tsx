import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/bidwave";
import { LiveRealtime } from "@/app/(public)/live/live-realtime";
import { SquadBoard } from "@/components/auction/squad-board";
import { selectCurrentEdition } from "@/lib/event-edition";
import { getSettingsForEdition } from "@/lib/supabase/settings";
import { buildSquadBoard, seatedTeams, type BoardPlayerRow } from "@/lib/auction/board";

export const metadata: Metadata = { title: "Live Auction" };
export const dynamic = "force-dynamic";

/**
 * PUB-05/06, LIVE-01..08. Two things: the one-screen squad board across every
 * franchise, then the running sale log as "<player> sold to <franchise>".
 *
 * History worth knowing before editing this file: the board was previously
 * removed from here by explicit request, along with its queries, leaving only
 * the sale log. It is back by an equally explicit later decision (18 Aug
 * 2026) to show squads, prices and purses publicly. The on-the-block hero,
 * the full player-pool grid and the analytics purchased/locked badges stay
 * gone — do not restore those alongside it.
 *
 * Everything here runs as `anon`, so it reads only the curated public views:
 * `players_public` (no `stats` column — the paid analytics unlock stays
 * intact) and `public_team_purses`. It must never read `players` or
 * `purse_ledger`; `qualifications` is also unreadable here under RLS, which
 * is why the board's field comes from the seated franchise assignments.
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

  const [{ data: sales }, settings, { data: soldPlayers }, { data: purses }] = await Promise.all([
    // public_sales_feed carries no event_edition_id column to filter on; in
    // practice only the live edition has sales, and the alternative is a
    // migration to widen the view.
    supabase
      .from("public_sales_feed")
      .select("id, player_name, team_id, team_name, sold_at, reversed_at")
      .order("sold_at", { ascending: false }),
    getSettingsForEdition(edition.id, ["auction_franchise_assignments"]),
    supabase
      .from("players_public")
      .select("id, full_name, status, current_team_id, sale_price")
      .eq("event_edition_id", edition.id)
      .eq("status", "sold"),
    supabase
      .from("public_team_purses")
      .select("team_id, name, purse_balance")
      .eq("event_edition_id", edition.id),
  ]);

  const franchises = settings.auction_franchise_assignments ?? {};
  const rows = sales ?? [];

  const boardTeams = buildSquadBoard(
    seatedTeams(
      (purses ?? []).map((t) => ({
        team_id: t.team_id as string,
        name: t.name as string,
        purse_balance: Number(t.purse_balance ?? 0),
      })),
      franchises,
    ),
    (soldPlayers ?? []) as BoardPlayerRow[],
    franchises,
  );

  return (
    <div className="w-full">
      <LiveRealtime eventEditionId={edition.id} />

      {/* The board: one screen, every franchise, squads + prices + purse. */}
      {boardTeams.length > 0 && (
        <section className="px-6 pt-6">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h1 className="font-display text-2xl">Live Auction</h1>
            <p className="font-mono text-xs text-ink-3">
              {boardTeams.length} franchises · {rows.filter((s) => !s.reversed_at).length} sold
            </p>
          </div>
          {/* 9.5rem measured in-browser: public site header + this section's
              top padding + the heading line put the grid's top edge at 131px,
              so anything less overflows the fold. */}
          <SquadBoard teams={boardTeams} chromeRem={9.5} />
        </section>
      )}

      <div className="mx-auto w-full max-w-2xl space-y-8 px-6 pb-12 pt-12">
        <div className="text-center">
          {boardTeams.length === 0 && <h1 className="font-display text-4xl">Live Auction</h1>}
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
    </div>
  );
}
