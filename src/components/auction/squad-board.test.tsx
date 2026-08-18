import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SquadBoard } from "./squad-board";
import type { SquadBoardTeam } from "@/lib/auction/board";

// vitest.config.ts sets `globals: false`, so RTL's auto-cleanup never
// registers itself — same note as tracker/team-card.test.tsx.
afterEach(cleanup);

const player = (id: string, name: string, salePrice: number) => ({ id, name, salePrice });

function team(over: Partial<SquadBoardTeam> & { teamId: string }): SquadBoardTeam {
  return {
    name: "Registered Name",
    franchise: "KOCHI TUSKERS KERALA",
    purseBalance: 915_000_000,
    squad: [],
    ...over,
  };
}

describe("SquadBoard", () => {
  it("shows the franchise alias and purse left in compact crore", () => {
    render(<SquadBoard teams={[team({ teamId: "t1" })]} />);
    expect(screen.getByRole("heading", { name: "KOCHI TUSKERS KERALA" })).toBeInTheDocument();
    expect(screen.getByText("₹91.5cr")).toBeInTheDocument();
  });

  it("lists each player with the price paid", () => {
    render(
      <SquadBoard
        teams={[
          team({
            teamId: "t1",
            squad: [player("p1", "KL RAHUL", 230_000_000), player("p2", "MOHAMMAD SHAMI", 105_000_000)],
          }),
        ]}
      />,
    );
    expect(within(screen.getByText("KL RAHUL").closest("li")!).getByText("₹23cr")).toBeInTheDocument();
    expect(
      within(screen.getByText("MOHAMMAD SHAMI").closest("li")!).getByText("₹10.5cr"),
    ).toBeInTheDocument();
  });

  it("says so rather than rendering an empty box before a team has bought", () => {
    render(<SquadBoard teams={[team({ teamId: "t1" })]} />);
    expect(screen.getByText("No players yet")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("falls back to the registered name when no alias is seated", () => {
    render(<SquadBoard teams={[team({ teamId: "t1", franchise: null, name: "T.V.K" })]} />);
    expect(screen.getByRole("heading", { name: "T.V.K" })).toBeInTheDocument();
  });

  it("renders every team given, so the 6-across grid always has 12 cells", () => {
    const teams = Array.from({ length: 12 }, (_, i) =>
      team({ teamId: `t${i}`, franchise: `FRANCHISE ${i}` }),
    );
    render(<SquadBoard teams={teams} />);
    expect(screen.getAllByRole("heading")).toHaveLength(12);
  });

  it("keeps each squad list scrollable so a full 23-man roster cannot push the grid", () => {
    const full = Array.from({ length: 23 }, (_, i) => player(`p${i}`, `PLAYER ${i}`, 20_000_000));
    render(<SquadBoard teams={[team({ teamId: "t1", squad: full })]} />);
    // The class is the mechanism — jsdom has no layout, so the guarantee is
    // asserted structurally: the list scrolls inside a min-h-0 flex child.
    const list = screen.getByRole("list");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("min-h-0");
    expect(screen.getAllByRole("listitem")).toHaveLength(23);
  });

  it("marks the viewing team's own tile so a captain can find it at a glance", () => {
    const { container } = render(
      <SquadBoard
        teams={[
          team({ teamId: "t1", franchise: "MUMBAI INDIANS", isViewer: true }),
          team({ teamId: "t2", franchise: "PUNJAB KINGS" }),
        ]}
      />,
    );
    const tiles = [...container.querySelectorAll("section")];
    expect(tiles[0].className).toContain("ring-gold/30");
    expect(tiles[1].className).not.toContain("ring-gold/30");
  });

  it("lets each surface set its own chrome allowance for the one-screen fit", () => {
    const { container } = render(<SquadBoard teams={[team({ teamId: "t1" })]} chromeRem={7} />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.getPropertyValue("--board-chrome")).toBe("7rem");
    expect(grid.className).toContain("lg:h-[calc(100vh-var(--board-chrome))]");
  });
});
