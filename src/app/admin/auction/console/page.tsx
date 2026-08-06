import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ConsoleSaleEntry } from "@/app/admin/auction/console/console-sale-entry";
import { ConsoleSalesLog } from "@/app/admin/auction/console/console-sales-log";

export const metadata: Metadata = { title: "Auction Console" };
export const dynamic = "force-dynamic";

export default async function AdminAuctionConsolePage() {
  const supabase = await createClient();

  const { data: edition } = await supabase
    .from("event_editions")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  if (!edition) {
    return <div className="p-10 text-ink-2">No active event edition.</div>;
  }

  const [{ data: state }, { data: teams }, { data: recentSales }, { data: ruleSet }, { data: soldPlayers }] =
    await Promise.all([
      supabase.from("auction_state").select("*").eq("event_edition_id", edition.id).maybeSingle(),
      supabase.from("public_team_purses").select("*").eq("event_edition_id", edition.id).order("name"),
      supabase
        .from("auction_sales")
        .select(
          "id, player_id, team_id, amount, sold_at, reversed_at, reversal_reason, players(full_name, updated_at), teams(name)",
        )
        .eq("event_edition_id", edition.id)
        .order("sold_at", { ascending: false })
        .limit(30),
      supabase.from("auction_rule_sets").select("*").eq("event_edition_id", edition.id).eq("is_active", true).maybeSingle(),
      supabase
        .from("players")
        .select("current_team_id, role, pool, is_overseas")
        .eq("event_edition_id", edition.id)
        .eq("status", "sold"),
    ]);

  // A5: admin console had no visibility into a team's squad/overseas
  // constraints before attempting a sale — only a reactive violation dump
  // after rejection. Mirror the team-facing compliance summary
  // (src/app/app/auction/page.tsx) so the admin sees it live per team.
  const rosterByTeam: Record<
    string,
    { squadSize: number; overseasCount: number; roleCounts: Record<string, number>; poolCounts: Record<string, number> }
  > = {};
  for (const p of soldPlayers ?? []) {
    if (!p.current_team_id) continue;
    const entry = (rosterByTeam[p.current_team_id] ??= {
      squadSize: 0,
      overseasCount: 0,
      roleCounts: {},
      poolCounts: {},
    });
    entry.squadSize += 1;
    if (p.is_overseas) entry.overseasCount += 1;
    entry.roleCounts[p.role] = (entry.roleCounts[p.role] ?? 0) + 1;
    entry.poolCounts[p.pool] = (entry.poolCounts[p.pool] ?? 0) + 1;
  }

  // auction_state.active_player_id is a pointer, not a guarantee — record_sale/
  // mark_player_unsold move the player out of 'active' status but don't (and
  // shouldn't) reach into auction_state to clear it, since a player can leave
  // 'active' via several different RPCs. The console only ever treats a
  // player as "the one up for bidding" if their live status still says so.
  const activePlayerRow = state?.active_player_id
    ? (await supabase.from("players").select("*").eq("id", state.active_player_id).maybeSingle()).data
    : null;
  const activePlayer = activePlayerRow?.status === "active" ? activePlayerRow : null;

  const salesRows = (recentSales ?? []).map((s) => ({
    id: s.id,
    player_id: s.player_id,
    player_name: (s.players as unknown as { full_name: string; updated_at: string } | null)?.full_name ?? "—",
    player_updated_at:
      (s.players as unknown as { full_name: string; updated_at: string } | null)?.updated_at ?? "",
    team_id: s.team_id,
    team_name: (s.teams as unknown as { name: string } | null)?.name ?? "—",
    amount: s.amount,
    sold_at: s.sold_at,
    reversed_at: s.reversed_at,
    reversal_reason: s.reversal_reason,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl">Auction Console</h1>
          <p className="text-sm text-ink-2">AUC-08..20: record sales, correct mistakes.</p>
        </div>
        {state?.ended_at ? (
          <span className="rounded-full border border-unsold/30 bg-unsold/10 px-3 py-1 text-xs font-semibold uppercase text-unsold">
            Auction ended
          </span>
        ) : null}
      </div>

      <ConsoleSaleEntry
        eventEditionId={edition.id}
        activePlayer={activePlayer ?? null}
        teams={teams ?? []}
        auctionEnded={!!state?.ended_at}
        ruleSet={
          ruleSet
            ? {
                min_squad_size: ruleSet.min_squad_size,
                max_squad_size: ruleSet.max_squad_size,
                max_overseas: ruleSet.max_overseas,
              }
            : null
        }
        rosterByTeam={rosterByTeam}
      />

      <ConsoleSalesLog sales={salesRows} />
    </div>
  );
}
