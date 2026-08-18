import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { StatTile, Money, EmptyState } from "@/components/bidwave";
import { selectCurrentEdition } from "@/lib/event-edition";
import { getSettingsForEdition } from "@/lib/supabase/settings";
import { TrackerRealtime } from "@/app/admin/auction/tracker/tracker-realtime";
import { TeamCard } from "@/app/admin/auction/tracker/team-card";
import {
  buildTeamTrackers,
  cheapestRemainingBase,
  computeMarketPulse,
  type LedgerRow,
  type PlayerRow,
} from "@/lib/auction/analytics";

export const metadata: Metadata = { title: "Auction — Live Tracker" };
export const dynamic = "force-dynamic";

/**
 * Live tracking board: every bidding team, its full squad, what each player
 * cost, and what purse is left. The analytics page next door answers "how is
 * the market behaving" in aggregate; this one answers the operational
 * question an auctioneer actually asks between lots — "who owns what, and who
 * can still afford this player".
 *
 * Everything here is read-only and derived server-side (principle #1); the
 * page holds no purse arithmetic of its own beyond formatting.
 */
export default async function AdminAuctionTrackerPage() {
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return <div className="p-10 text-ink-2">No active event edition.</div>;

  // Who is in the auction is never a hardcoded team count — it is whoever
  // qualified at the gate the sale engine enforces. record_sale resolves that
  // gate through the *active rule set's* round
  // (team_meets_stage_requirement(v_rule_set.round_id, …)), so this does too:
  // keying off `rounds.kind = 'auction'` instead would break the moment a
  // second auction round exists in one edition, since maybeSingle() throws on
  // multiple rows.
  const { data: activeRuleSet } = await supabase
    .from("auction_rule_sets")
    .select("*")
    .eq("event_edition_id", edition.id)
    .eq("is_active", true)
    .maybeSingle();

  const { data: gateRound } = activeRuleSet?.round_id
    ? await supabase
        .from("rounds")
        .select("requires_qualification_from_stage")
        .eq("id", activeRuleSet.round_id)
        .maybeSingle()
    : { data: null };

  const gateStageId = gateRound?.requires_qualification_from_stage ?? null;

  const [{ data: playerRows }, { data: purses }, { data: ledgerRows }, settings, { data: quals }] =
    await Promise.all([
      supabase
        .from("players")
        .select(
          "id, full_name, role, pool, status, is_overseas, base_price, sale_price, current_team_id, sold_at",
        )
        .eq("event_edition_id", edition.id),
      supabase.from("public_team_purses").select("*").eq("event_edition_id", edition.id),
      supabase
        .from("purse_ledger")
        .select("team_id, entry_kind, amount")
        .eq("event_edition_id", edition.id),
      getSettingsForEdition(edition.id, ["auction_franchise_assignments"]),
      gateStageId
        ? supabase
            .from("qualifications")
            .select("team_id, rank")
            .eq("stage_id", gateStageId)
            .eq("decision", "qualified")
        : Promise.resolve({ data: [] as { team_id: string; rank: number | null }[] }),
    ]);

  const players = (playerRows ?? []) as PlayerRow[];
  const ledger = (ledgerRows ?? []) as LedgerRow[];
  const franchises = settings.auction_franchise_assignments ?? {};

  const limits = {
    minSquadSize: activeRuleSet?.min_squad_size ?? 0,
    maxSquadSize: activeRuleSet?.max_squad_size ?? 0,
    maxOverseas: activeRuleSet?.max_overseas ?? 0,
  };

  const qualifiedRank = new Map(
    (quals ?? []).map((q) => [q.team_id as string, (q.rank as number | null) ?? null]),
  );
  const allTeams = (purses ?? []).map((t) => ({
    team_id: t.team_id as string,
    name: t.name as string,
    purse_balance: Number(t.purse_balance ?? 0),
  }));
  const gateResolved = qualifiedRank.size > 0;
  // public_team_purses spans every registered team, so it has to be narrowed
  // to the qualified field before any total on this page means anything.
  const biddingTeams = gateResolved
    ? allTeams.filter((t) => qualifiedRank.has(t.team_id))
    : allTeams;

  const trackers = buildTeamTrackers(
    biddingTeams,
    players,
    ledger,
    franchises,
    qualifiedRank,
    limits,
    cheapestRemainingBase(players),
  );

  const pulse = computeMarketPulse(players);
  const roomFunded = trackers.reduce((a, t) => a + t.purse.funded, 0);
  const roomRemaining = trackers.reduce((a, t) => a + t.purse.balance, 0);
  const rostered = trackers.reduce((a, t) => a + t.squadSize, 0);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
      <TrackerRealtime eventEditionId={edition.id} />

      <div className="space-y-1">
        <h1 className="font-display text-2xl">Auction — Live Tracker</h1>
        <p className="text-sm text-ink-2">
          Every team, their squad, what each player cost and what purse is left. Updates live as
          sales are recorded.
        </p>
      </div>

      {trackers.length === 0 ? (
        <EmptyState
          title="No bidding teams yet"
          description="Record Rounds 3 + 4 qualification decisions in Stages to seat the auction field."
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Teams bidding"
              value={trackers.length}
              hint={gateResolved ? "Qualified field" : "Gate undecided — all teams"}
            />
            <StatTile
              label="Purse remaining"
              value={<Money value={roomRemaining} />}
              tone="gold"
              hint={
                <>
                  of <Money value={roomFunded} className="text-xs" /> funded
                </>
              }
            />
            <StatTile
              label="Committed"
              value={<Money value={pulse.totalSpend} />}
              hint={`${rostered} player${rostered === 1 ? "" : "s"} rostered`}
            />
            <StatTile
              label="Lots left"
              value={pulse.lotsRemaining}
              hint={`${pulse.lotsSold} sold · ${pulse.lotsUnsold} unsold`}
            />
          </section>

          {!gateResolved && (
            <div className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-ink-2">
              No team is marked qualified at the auction&rsquo;s gating stage yet, so every
              registered team is listed.
            </div>
          )}

          <div className="space-y-5">
            {trackers.map((t) => (
              <TeamCard key={t.teamId} team={t} minSquadSize={limits.minSquadSize} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
