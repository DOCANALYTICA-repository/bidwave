import { describe, expect, it } from "vitest";
import { buildBiddingField, labelForTeam, type TeamPurseRow } from "@/lib/auction/bidding-field";

const team = (id: string, name: string, balance = 1_250_000_000): TeamPurseRow => ({
  team_id: id,
  name,
  purse_balance: balance,
});

// Deliberately mirrors production's shape: far more registered teams than
// bidding ones, which is exactly what the old selector got wrong.
const allTeams = [
  team("t1", "GUWAHATI MAVERICKS"),
  team("t2", "The Mavericks"),
  team("t3", "Christ Super Kings"),
  team("t99", "Some Eliminated Team"),
];

describe("buildBiddingField", () => {
  it("narrows to the qualified field and drops everyone else", () => {
    const field = buildBiddingField(allTeams, {}, new Set(["t1", "t2"]));
    expect(field.source).toBe("qualified");
    expect(field.teams.map((t) => t.teamId).sort()).toEqual(["t1", "t2"]);
  });

  it("labels a seated team by its franchise alias, not its registered name", () => {
    const field = buildBiddingField(
      allTeams,
      { t1: "MUMBAI INDIANS", t2: "CHENNAI SUPER KINGS" },
      new Set(["t1", "t2"]),
    );
    expect(field.teams.map((t) => t.label)).toEqual(["CHENNAI SUPER KINGS", "MUMBAI INDIANS"]);
    // The registered name is still carried for admin disambiguation.
    expect(field.teams.find((t) => t.teamId === "t1")!.name).toBe("GUWAHATI MAVERICKS");
    expect(field.missingAlias).toBe(0);
  });

  it("sorts by the label on screen, not by registered name", () => {
    // Registered order would be GUWAHATI, The Mavericks; aliases invert it.
    const field = buildBiddingField(
      allTeams,
      { t1: "SUNRISERS HYDERABAD", t2: "DELHI CAPITALS" },
      new Set(["t1", "t2"]),
    );
    expect(field.teams.map((t) => t.label)).toEqual(["DELHI CAPITALS", "SUNRISERS HYDERABAD"]);
  });

  it("counts teams still awaiting an alias so the console can warn", () => {
    const field = buildBiddingField(allTeams, { t1: "MUMBAI INDIANS" }, new Set(["t1", "t2"]));
    expect(field.missingAlias).toBe(1);
    // Falls back to the registered name rather than rendering a blank option.
    expect(field.teams.find((t) => t.teamId === "t2")!.label).toBe("The Mavericks");
  });

  it("falls back to seated franchises when no qualification is recorded", () => {
    const field = buildBiddingField(allTeams, { t1: "MUMBAI INDIANS" }, new Set());
    expect(field.source).toBe("franchise");
    expect(field.teams.map((t) => t.teamId)).toEqual(["t1"]);
  });

  it("never widens past the qualified field, even when a franchise is unqualified", () => {
    // t99 is seated but not qualified — record_sale would reject it, so it
    // must not be selectable.
    const field = buildBiddingField(
      allTeams,
      { t1: "MUMBAI INDIANS", t99: "PUNJAB KINGS" },
      new Set(["t1"]),
    );
    expect(field.teams.map((t) => t.teamId)).toEqual(["t1"]);
  });

  it("offers every team, flagged, when neither gate is configured", () => {
    const field = buildBiddingField(allTeams, {}, new Set());
    expect(field.source).toBe("unnarrowed");
    expect(field.teams).toHaveLength(4);
    expect(field.missingAlias).toBe(4);
  });

  it("carries the purse balance through as a number", () => {
    const field = buildBiddingField([team("t1", "A", 130_000_000)], {}, new Set(["t1"]));
    expect(field.teams[0].purseBalance).toBe(130_000_000);
  });

  it("yields an empty field rather than throwing when nothing qualifies into it", () => {
    const field = buildBiddingField(allTeams, {}, new Set(["nobody"]));
    expect(field.teams).toEqual([]);
    expect(field.source).toBe("qualified");
  });
});

describe("labelForTeam", () => {
  const field = buildBiddingField(allTeams, { t1: "MUMBAI INDIANS" }, new Set(["t1", "t2"])).teams;

  it("prefers the alias for a team in the field", () => {
    expect(labelForTeam("t1", field, "fallback")).toBe("MUMBAI INDIANS");
  });

  it("falls back for a team no longer in the field — e.g. a reversed sale", () => {
    expect(labelForTeam("t99", field, "Some Eliminated Team")).toBe("Some Eliminated Team");
  });

  it("falls back for a null team id", () => {
    expect(labelForTeam(null, field, "—")).toBe("—");
  });
});
