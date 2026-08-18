import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamCard } from "./team-card";
import type { SquadPlayer, TeamTracker } from "@/lib/auction/analytics";

// vitest.config.ts sets `globals: false`, so RTL's auto-cleanup — which
// registers itself on a global afterEach — never runs. Without this the DOM
// accumulates across tests in this file and every getByText finds duplicates.
afterEach(cleanup);

function squadPlayer(over: Partial<SquadPlayer> & { id: string }): SquadPlayer {
  return {
    name: `Player ${over.id}`,
    role: "BATTER",
    pool: "POT 01 · MARQUEE 1",
    isOverseas: false,
    basePrice: 20_000_000,
    salePrice: 40_000_000,
    soldAt: "2026-08-19T10:00:00Z",
    realisation: 2,
    ...over,
  };
}

function tracker(over: Partial<TeamTracker> = {}): TeamTracker {
  return {
    teamId: "t1",
    name: "GUWAHATI MAVERICKS",
    franchise: null,
    rank: 1,
    purse: {
      funded: 1_300_000_000,
      playerSpend: 260_000_000,
      analyticsSpend: 0,
      balance: 1_040_000_000,
    },
    squad: [squadPlayer({ id: "a" })],
    squadSize: 1,
    overseasCount: 0,
    slotsToMinimum: 17,
    slotsToMaximum: 22,
    averagePrice: 40_000_000,
    overseasRemaining: 8,
    maxBidNow: 1_008_000_000,
    ...over,
  };
}

describe("TeamCard", () => {
  it("renders the team, its purse figures and its roster", () => {
    render(<TeamCard team={tracker()} minSquadSize={18} />);

    expect(screen.getByRole("heading", { name: "GUWAHATI MAVERICKS" })).toBeInTheDocument();
    // Indian digit grouping, per the shared Money component.
    expect(screen.getByText("₹1,04,00,00,000")).toBeInTheDocument();
    expect(screen.getByText("Player a")).toBeInTheDocument();
    expect(screen.getByText("2.00×")).toBeInTheDocument();
  });

  it("shows the franchise label while keeping the registered name visible", () => {
    render(<TeamCard team={tracker({ franchise: "Guwahati Mavericks" })} minSquadSize={18} />);
    expect(screen.getByRole("heading", { name: "Guwahati Mavericks" })).toBeInTheDocument();
    expect(screen.getByText("GUWAHATI MAVERICKS")).toBeInTheDocument();
  });

  it("says so plainly when a team has bought nobody yet", () => {
    render(
      <TeamCard
        team={tracker({ squad: [], squadSize: 0, averagePrice: null })}
        minSquadSize={18}
      />,
    );
    expect(screen.getByText("No players bought yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("labels the spend bar for screen readers instead of relying on colour", () => {
    render(<TeamCard team={tracker()} minSquadSize={18} />);
    expect(screen.getByRole("img", { name: "20% of purse spent" })).toBeInTheDocument();
  });

  it("does not divide by zero when a team has no funding entries at all", () => {
    render(
      <TeamCard
        team={tracker({
          purse: { funded: 0, playerSpend: 0, analyticsSpend: 0, balance: 0 },
          squad: [],
          squadSize: 0,
          averagePrice: null,
        })}
        minSquadSize={18}
      />,
    );
    expect(screen.getByRole("img", { name: "0% of purse spent" })).toBeInTheDocument();
  });

  it("flags overseas players in the roster", () => {
    render(
      <TeamCard
        team={tracker({ squad: [squadPlayer({ id: "a", isOverseas: true })] })}
        minSquadSize={18}
      />,
    );
    const row = screen.getByText("Player a").closest("tr")!;
    expect(within(row).getByText("Overseas")).toBeInTheDocument();
  });

  it("renders an em dash rather than NaN when a lot had no base price", () => {
    render(
      <TeamCard
        team={tracker({ squad: [squadPlayer({ id: "a", basePrice: 0, realisation: null })] })}
        minSquadSize={18}
      />,
    );
    const row = screen.getByText("Player a").closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("surfaces analytics spend only when the team actually unlocked it", () => {
    const { rerender } = render(<TeamCard team={tracker()} minSquadSize={18} />);
    expect(screen.queryByText(/on analytics/)).not.toBeInTheDocument();

    rerender(
      <TeamCard
        team={tracker({
          purse: {
            funded: 1_300_000_000,
            playerSpend: 260_000_000,
            analyticsSpend: 50_000_000,
            balance: 990_000_000,
          },
        })}
        minSquadSize={18}
      />,
    );
    expect(screen.getByText(/on analytics/)).toBeInTheDocument();
  });
});
