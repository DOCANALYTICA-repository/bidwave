import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ConsoleSaleEntry } from "@/app/admin/auction/console/console-sale-entry";
import { ConsoleSalesLog } from "@/app/admin/auction/console/console-sales-log";
import { selectCurrentEdition } from "@/lib/event-edition";
import { getSettingsForEdition } from "@/lib/supabase/settings";
import { buildBiddingField, labelForTeam } from "@/lib/auction/bidding-field";

export const metadata: Metadata = { title: "Auction Console" };
export const dynamic = "force-dynamic";

export default async function AdminAuctionConsolePage() {
  const supabase = await createClient();

  const { data: edition } = await selectCurrentEdition(supabase);

  if (!edition) {
    return <div className="p-10 text-ink-2">No active event edition.</div>;
  }

  const [
    { data: state },
    { data: teams },
    { data: recentSales },
    { data: ruleSet },
    { data: soldPlayers },
    { data: openPlayers },
    settings,
  ] = await Promise.all([
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
      // The console's own player search. Sent down whole rather than queried
      // per keystroke: it is ~140 rows at the point the lower pools start, so
      // filtering in the browser is instant, and a lot clearing every ~40
      // seconds cannot afford a network round-trip per character. 'recalled'
      // rides along because it is an activatable state like 'available'.
      supabase
        .from("players")
        .select("id, full_name, role, pool, base_price, status, is_overseas, updated_at")
        .eq("event_edition_id", edition.id)
        .in("status", ["available", "unsold", "recalled"])
        // Pool names are prefixed 'POT nn · …' precisely so a lexical sort is
        // bidding order (see the auction import script), which is also the most
        // useful order for the unfiltered dropdown: what is coming up next.
        .order("pool")
        .order("full_name"),
      getSettingsForEdition(edition.id, ["auction_franchise_assignments"]),
    ]);

  // The selector must offer exactly the teams record_sale will accept, under
  // the names the room is using. record_sale gates on the *active rule set's*
  // round (team_meets_stage_requirement(v_rule_set.round_id, …)), so the gate
  // is resolved through the rule set rather than by looking up "the auction
  // round" — the two coincide today but the rule set is the authority.
  const { data: gateRound } = ruleSet?.round_id
    ? await supabase
        .from("rounds")
        .select("requires_qualification_from_stage")
        .eq("id", ruleSet.round_id)
        .maybeSingle()
    : { data: null };

  const { data: quals } = gateRound?.requires_qualification_from_stage
    ? await supabase
        .from("qualifications")
        .select("team_id")
        .eq("stage_id", gateRound.requires_qualification_from_stage)
        .eq("decision", "qualified")
    : { data: [] as { team_id: string }[] };

  const biddingField = buildBiddingField(
    (teams ?? []).map((t) => ({
      team_id: t.team_id as string,
      name: t.name as string,
      purse_balance: Number(t.purse_balance ?? 0),
    })),
    settings.auction_franchise_assignments ?? {},
    new Set((quals ?? []).map((q) => q.team_id as string)),
  );

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
    // Alias-first here too: a log reading "Royal Mavericks" next to a selector
    // reading "MUMBAI INDIANS" is the same misheard-sale hazard. Falls back to
    // the joined registered name for a team no longer in the field (e.g. a
    // reversed sale for a team since unseated).
    team_name: labelForTeam(
      s.team_id,
      biddingField.teams,
      (s.teams as unknown as { name: string } | null)?.name ?? "—",
    ),
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
        openPlayers={openPlayers ?? []}
        biddingField={biddingField}
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
