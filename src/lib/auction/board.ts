/**
 * The squad board's data shape, shared by all three surfaces that show it:
 * the admin tracker, the public /live page and every team's own dashboard.
 *
 * Deliberately the *narrowest* projection that renders the board — franchise,
 * purse left, and each player with the price paid. Nothing else. That matters
 * because the public page runs as `anon`: it reads `players_public` (the
 * curated view without `stats`) and `public_team_purses`, never the base
 * tables, so this module must never require a column those views lack.
 *
 * Which teams appear is the *caller's* decision, not this module's, because
 * the right answer differs by audience:
 *   - admin resolves the field through stage qualification (what record_sale
 *     enforces), which `anon` cannot read — `qualifications` returns zero rows
 *     under RLS for a logged-out visitor;
 *   - public and team surfaces resolve it from the seated franchise
 *     assignments in `settings`, which anon can read.
 * Today those two sets are identical (12 seated, 12 qualified).
 */

export type BoardPlayerRow = {
  id: string;
  full_name: string;
  status: string;
  current_team_id: string | null;
  sale_price: number | null;
};

export type BoardTeamRow = { team_id: string; name: string; purse_balance: number };

export type SquadBoardPlayer = { id: string; name: string; salePrice: number };

export type SquadBoardTeam = {
  teamId: string;
  /** Registered name — shown only when no franchise alias is seated. */
  name: string;
  franchise: string | null;
  purseBalance: number;
  squad: SquadBoardPlayer[];
  /** Highlights this team's own tile on the team-facing board. */
  isViewer?: boolean;
};

export function buildSquadBoard(
  teams: BoardTeamRow[],
  players: BoardPlayerRow[],
  franchises: Record<string, string>,
  options: {
    /** Qualifying rank per team; when absent the board sorts by label. */
    ranks?: Map<string, number | null>;
    /** Team id of the signed-in team, so its own tile can be marked. */
    viewerTeamId?: string | null;
  } = {},
): SquadBoardTeam[] {
  const squads = new Map<string, SquadBoardPlayer[]>();
  for (const p of players) {
    if (p.status !== "sold" || !p.current_team_id) continue;
    const list = squads.get(p.current_team_id) ?? [];
    list.push({ id: p.id, name: p.full_name, salePrice: Number(p.sale_price ?? 0) });
    squads.set(p.current_team_id, list);
  }
  // Dearest first — the buy a reader looks for on a crowded tile.
  for (const list of squads.values()) list.sort((a, b) => b.salePrice - a.salePrice);

  const { ranks, viewerTeamId } = options;

  return teams
    .map((t) => ({
      teamId: t.team_id,
      name: t.name,
      franchise: franchises[t.team_id] ?? null,
      purseBalance: Number(t.purse_balance ?? 0),
      squad: squads.get(t.team_id) ?? [],
      isViewer: viewerTeamId != null && t.team_id === viewerTeamId,
    }))
    .sort((a, b) => {
      if (ranks) {
        const ra = ranks.get(a.teamId);
        const rb = ranks.get(b.teamId);
        if (ra != null && rb != null && ra !== rb) return ra - rb;
        if (ra != null && rb == null) return -1;
        if (rb != null && ra == null) return 1;
      }
      return (a.franchise ?? a.name).localeCompare(b.franchise ?? b.name);
    });
}

/**
 * The public/team field: teams that have been seated as a franchise. Used
 * where `qualifications` is unreadable — see the module note above.
 */
export function seatedTeams(
  teams: BoardTeamRow[],
  franchises: Record<string, string>,
): BoardTeamRow[] {
  // No assignments yet (pre-setup) would otherwise render an empty board on
  // the public page; showing nothing is right there — a board of 97
  // registered teams is not what /live is for.
  return teams.filter((t) => franchises[t.team_id]);
}
