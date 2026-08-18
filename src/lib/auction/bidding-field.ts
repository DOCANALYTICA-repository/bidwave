/**
 * Who may be sold a player, and what to call them on screen.
 *
 * Two separate problems the console conflated before:
 *
 *  1. `public_team_purses` spans every registered team (97 for bidwave-2026),
 *     but `record_sale` only accepts a team that qualified at the active rule
 *     set's round gate. Offering all 97 in the sale selector meant the
 *     auctioneer could pick a team the server was always going to reject.
 *
 *  2. During the live auction a team is its franchise identity ("MUMBAI
 *     INDIANS"), not the name it registered under. The alias is the label the
 *     room, the caller and the big screen all use, so the console has to speak
 *     the same language — a mismatch here is a misheard sale.
 *
 * Pure functions over rows the caller already fetched, same contract as
 * lib/auction/analytics.ts.
 */

export type TeamPurseRow = { team_id: string; name: string; purse_balance: number };

export type BiddingTeamOption = {
  teamId: string;
  /** Registered name. Kept for admin disambiguation, never the primary label. */
  name: string;
  /** Franchise alias (IPL identity) when the team has been seated in Setup. */
  franchise: string | null;
  purseBalance: number;
  /** What the console shows: the alias when seated, the registered name until then. */
  label: string;
};

/**
 * How the field got narrowed. The console needs this to explain itself: an
 * empty or over-wide selector is otherwise indistinguishable from a bug.
 */
export type BiddingFieldSource =
  /** Narrowed by stage qualification — matches what record_sale enforces. */
  | "qualified"
  /** No qualification decisions recorded; fell back to the seated franchises. */
  | "franchise"
  /** Neither gate is set up — every registered team is offered. */
  | "unnarrowed";

export type BiddingField = {
  teams: BiddingTeamOption[];
  source: BiddingFieldSource;
  /** Teams in the field still showing a registered name because no alias is seated. */
  missingAlias: number;
};

export function buildBiddingField(
  teams: TeamPurseRow[],
  /** team_id -> franchise alias, from the auction_franchise_assignments setting. */
  franchises: Record<string, string>,
  /** Team ids marked qualified at the active rule set's round gate. */
  qualifiedTeamIds: Set<string>,
): BiddingField {
  // Qualification is the gate the server actually enforces, so it wins when
  // it has been decided. Franchise seating is only a fallback for the window
  // before Rounds 3 + 4 decisions are recorded — it must never *widen* the
  // field past what record_sale would accept.
  let source: BiddingFieldSource;
  let inField: TeamPurseRow[];

  if (qualifiedTeamIds.size > 0) {
    source = "qualified";
    inField = teams.filter((t) => qualifiedTeamIds.has(t.team_id));
  } else if (Object.keys(franchises).length > 0) {
    source = "franchise";
    inField = teams.filter((t) => franchises[t.team_id]);
  } else {
    source = "unnarrowed";
    inField = teams;
  }

  const options = inField
    .map((t) => {
      const franchise = franchises[t.team_id] ?? null;
      return {
        teamId: t.team_id,
        name: t.name,
        franchise,
        purseBalance: Number(t.purse_balance ?? 0),
        label: franchise ?? t.name,
      };
    })
    // Alphabetical by the label actually on screen: mid-auction the caller is
    // scanning for a franchise name, not for a qualifying rank.
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    teams: options,
    source,
    missingAlias: options.filter((t) => !t.franchise).length,
  };
}

/** Alias-first label for a team id, for surfaces outside the selector. */
export function labelForTeam(
  teamId: string | null,
  field: BiddingTeamOption[],
  fallback: string,
): string {
  if (!teamId) return fallback;
  return field.find((t) => t.teamId === teamId)?.label ?? fallback;
}
