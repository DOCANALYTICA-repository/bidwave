import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { selectCurrentEdition } from "@/lib/event-edition";
import { getSettingsForEdition } from "@/lib/supabase/settings";
import { buildBiddingField, labelForTeam } from "@/lib/auction/bidding-field";
import { TradeForm, type TradeSquadPlayer } from "@/app/admin/auction/trades/trade-form";
import { TradesLog, type TradeLogRow } from "@/app/admin/auction/trades/trades-log";

export const metadata: Metadata = { title: "Auction — Trade Block" };
export const dynamic = "force-dynamic";

/**
 * The trade block: two franchises, players and cash each way, one atomic move.
 *
 * There is no trade-specific projection of "who owns what" anywhere in here —
 * a squad is `players.current_team_id where status = 'sold'` and a purse is the
 * ledger sum, exactly as the tracker, the console and /live read them. That is
 * the whole reason executing a trade needs no follow-up anywhere else: it moves
 * those two things and every other surface is already looking at them.
 */
export default async function AdminAuctionTradesPage() {
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return <div className="p-10 text-ink-2">No active event edition.</div>;

  const { data: ruleSet } = await supabase
    .from("auction_rule_sets")
    .select("*")
    .eq("event_edition_id", edition.id)
    .eq("is_active", true)
    .maybeSingle();

  // The tradeable field is the bidding field: execute_trade requires both
  // franchises to be active, and a team that never qualified has no squad to
  // trade anyway. Resolved through the same helper the console uses so the two
  // tabs can never disagree on what a franchise is called.
  const { data: gateRound } = ruleSet?.round_id
    ? await supabase
        .from("rounds")
        .select("requires_qualification_from_stage")
        .eq("id", ruleSet.round_id)
        .maybeSingle()
    : { data: null };

  const [{ data: purses }, { data: soldPlayers }, { data: trades }, { data: legs }, settings, { data: quals }] =
    await Promise.all([
      supabase.from("public_team_purses").select("*").eq("event_edition_id", edition.id),
      supabase
        .from("players")
        .select("id, full_name, role, pool, is_overseas, sale_price, current_team_id")
        .eq("event_edition_id", edition.id)
        .eq("status", "sold")
        .order("full_name"),
      supabase
        .from("auction_trades")
        .select("*")
        .eq("event_edition_id", edition.id)
        .order("executed_at", { ascending: false })
        .limit(50),
      supabase
        .from("auction_trade_players")
        .select("trade_id, player_id, from_team_id, to_team_id, price_at_trade, players(full_name)")
        .order("created_at"),
      getSettingsForEdition(edition.id, ["auction_franchise_assignments"]),
      gateRound?.requires_qualification_from_stage
        ? supabase
            .from("qualifications")
            .select("team_id")
            .eq("stage_id", gateRound.requires_qualification_from_stage)
            .eq("decision", "qualified")
        : Promise.resolve({ data: [] as { team_id: string }[] }),
    ]);

  const biddingField = buildBiddingField(
    (purses ?? []).map((t) => ({
      team_id: t.team_id as string,
      name: t.name as string,
      purse_balance: Number(t.purse_balance ?? 0),
    })),
    settings.auction_franchise_assignments ?? {},
    new Set((quals ?? []).map((q) => q.team_id as string)),
  );

  const squadsByTeam: Record<string, TradeSquadPlayer[]> = {};
  for (const p of soldPlayers ?? []) {
    if (!p.current_team_id) continue;
    (squadsByTeam[p.current_team_id] ??= []).push({
      id: p.id,
      fullName: p.full_name,
      role: p.role,
      pool: p.pool,
      isOverseas: p.is_overseas,
      salePrice: Number(p.sale_price ?? 0),
    });
  }
  // Dearest first — the name an admin scans a tile for, same order as the board.
  for (const list of Object.values(squadsByTeam)) list.sort((a, b) => b.salePrice - a.salePrice);

  // Legs are fetched for the whole table rather than filtered per trade id, so
  // the log is one round-trip regardless of how many trades exist.
  const legsByTrade: Record<string, TradeLogRow["legs"]> = {};
  for (const leg of legs ?? []) {
    (legsByTrade[leg.trade_id] ??= []).push({
      playerId: leg.player_id,
      playerName: (leg.players as unknown as { full_name: string } | null)?.full_name ?? "—",
      fromTeam: labelForTeam(leg.from_team_id, biddingField.teams, "—"),
      toTeam: labelForTeam(leg.to_team_id, biddingField.teams, "—"),
      priceAtTrade: leg.price_at_trade == null ? null : Number(leg.price_at_trade),
    });
  }

  const tradeRows: TradeLogRow[] = (trades ?? []).map((t) => ({
    id: t.id,
    teamA: labelForTeam(t.team_a_id, biddingField.teams, "—"),
    teamB: labelForTeam(t.team_b_id, biddingField.teams, "—"),
    cashAToB: Number(t.cash_a_to_b ?? 0),
    cashBToA: Number(t.cash_b_to_a ?? 0),
    memo: t.memo,
    executedAt: t.executed_at,
    reversedAt: t.reversed_at,
    reversalReason: t.reversal_reason,
    legs: legsByTrade[t.id] ?? [],
  }));

  const { data: auctionState } = await supabase
    .from("auction_state")
    .select("ended_at")
    .eq("event_edition_id", edition.id)
    .maybeSingle();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Auction — Trade Block</h1>
        <p className="text-sm text-ink-2">
          Swap squad players and cash between two franchises. Applied in one transaction, checked
          against the active rule set, and reflected everywhere the auction shows a squad or a purse.
        </p>
      </div>

      <TradeForm
        eventEditionId={edition.id}
        teams={biddingField.teams}
        squadsByTeam={squadsByTeam}
        auctionEnded={!!auctionState?.ended_at}
        ruleSet={
          ruleSet
            ? {
                maxSquadSize: ruleSet.max_squad_size,
                minSquadSize: ruleSet.min_squad_size,
                maxOverseas: ruleSet.max_overseas,
              }
            : null
        }
      />

      <TradesLog trades={tradeRows} />
    </div>
  );
}
