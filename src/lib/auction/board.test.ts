import { describe, expect, it } from "vitest";
import {
  buildSquadBoard,
  seatedTeams,
  type BoardPlayerRow,
  type BoardTeamRow,
} from "@/lib/auction/board";

const team = (id: string, name: string, balance = 1_250_000_000): BoardTeamRow => ({
  team_id: id,
  name,
  purse_balance: balance,
});

const sold = (id: string, name: string, teamId: string, price: number): BoardPlayerRow => ({
  id,
  full_name: name,
  status: "sold",
  current_team_id: teamId,
  sale_price: price,
});

const teams = [team("t1", "T.V.K", 915_000_000), team("t2", "GUWAHATI MAVERICKS")];
const franchises = { t1: "KOCHI TUSKERS KERALA", t2: "GUJARAT TITANS" };

describe("buildSquadBoard", () => {
  it("buckets sold players to their owning team, dearest first", () => {
    const board = buildSquadBoard(
      teams,
      [
        sold("p1", "MOHAMMAD SHAMI", "t1", 105_000_000),
        sold("p2", "KL RAHUL", "t1", 230_000_000),
        sold("p3", "VIRAT KOHLI", "t2", 50_000_000),
      ],
      franchises,
    );
    const tvk = board.find((t) => t.teamId === "t1")!;
    expect(tvk.squad.map((p) => p.name)).toEqual(["KL RAHUL", "MOHAMMAD SHAMI"]);
    expect(board.find((t) => t.teamId === "t2")!.squad).toHaveLength(1);
  });

  it("ignores anything not actually sold to a team", () => {
    const board = buildSquadBoard(
      teams,
      [
        { id: "a", full_name: "AVAILABLE", status: "available", current_team_id: null, sale_price: null },
        { id: "b", full_name: "UNSOLD", status: "unsold", current_team_id: null, sale_price: null },
        // Sold but with no owner recorded — must not crash or land anywhere.
        { id: "c", full_name: "ORPHAN", status: "sold", current_team_id: null, sale_price: 100 },
      ],
      franchises,
    );
    expect(board.every((t) => t.squad.length === 0)).toBe(true);
  });

  it("prefers the franchise alias and carries the purse balance", () => {
    const board = buildSquadBoard(teams, [], franchises);
    const tvk = board.find((t) => t.teamId === "t1")!;
    expect(tvk.franchise).toBe("KOCHI TUSKERS KERALA");
    expect(tvk.name).toBe("T.V.K");
    expect(tvk.purseBalance).toBe(915_000_000);
  });

  it("sorts by alias when no ranks are supplied", () => {
    const board = buildSquadBoard(teams, [], franchises);
    expect(board.map((t) => t.franchise)).toEqual(["GUJARAT TITANS", "KOCHI TUSKERS KERALA"]);
  });

  it("sorts by qualifying rank when supplied, unranked last", () => {
    const board = buildSquadBoard(teams, [], franchises, {
      ranks: new Map([["t1", 1]]),
    });
    expect(board.map((t) => t.teamId)).toEqual(["t1", "t2"]);
  });

  it("falls back to alias order for teams tied on rank", () => {
    // Ranks 7 and 7 exist in production — a tie the stage never broke.
    const board = buildSquadBoard(teams, [], franchises, {
      ranks: new Map([
        ["t1", 7],
        ["t2", 7],
      ]),
    });
    expect(board.map((t) => t.franchise)).toEqual(["GUJARAT TITANS", "KOCHI TUSKERS KERALA"]);
  });

  it("marks only the viewing team's own tile", () => {
    const board = buildSquadBoard(teams, [], franchises, { viewerTeamId: "t2" });
    expect(board.find((t) => t.teamId === "t2")!.isViewer).toBe(true);
    expect(board.find((t) => t.teamId === "t1")!.isViewer).toBe(false);
  });

  it("marks nobody when there is no viewer — the public board", () => {
    const board = buildSquadBoard(teams, [], franchises);
    expect(board.every((t) => t.isViewer === false)).toBe(true);
  });

  it("treats a null sale price as zero rather than NaN", () => {
    const board = buildSquadBoard(
      teams,
      [{ id: "p", full_name: "MYSTERY", status: "sold", current_team_id: "t1", sale_price: null }],
      franchises,
    );
    expect(board.find((t) => t.teamId === "t1")!.squad[0].salePrice).toBe(0);
  });
});

describe("seatedTeams", () => {
  it("keeps only teams that have been given a franchise identity", () => {
    const all = [...teams, team("t99", "Not Seated FC")];
    expect(seatedTeams(all, franchises).map((t) => t.team_id)).toEqual(["t1", "t2"]);
  });

  it("returns nothing before setup, so the public board hides rather than listing all 97", () => {
    expect(seatedTeams(teams, {})).toEqual([]);
  });
});
