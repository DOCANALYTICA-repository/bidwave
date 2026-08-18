import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { buildBiddingField } from "@/lib/auction/bidding-field";

// vitest.config.ts sets `globals: false`, so RTL's auto-cleanup never
// registers itself — same note as tracker/team-card.test.tsx.
afterEach(cleanup);

// The console is a client component wired to server actions, the router and
// the realtime socket. None of that is what this file is testing: the subject
// is what the sale selector *shows* mid-auction, so the plumbing is stubbed.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/realtime/use-live-broadcast", () => ({
  useLiveBroadcast: () => ({ status: "online" }),
}));
vi.mock("@/app/admin/auction/console/actions", () => ({
  recordSale: vi.fn(),
  setActivePlayer: vi.fn(),
  markPlayerUnsold: vi.fn(),
  endAuction: vi.fn(),
}));
vi.mock("@/app/admin/auction/console/console-lock-badge", () => ({
  ConsoleLockBadge: () => null,
}));

const { ConsoleSaleEntry } = await import(
  "@/app/admin/auction/console/console-sale-entry"
);

const activePlayer = {
  id: "p1",
  full_name: "KL RAHUL",
  role: "BATTER",
  pool: "POT 01 · MARQUEE 1",
  base_price: 20_000_000,
  updated_at: "2026-08-18T05:38:02.009Z",
  status: "active",
  // Remaining columns are irrelevant to the selector under test.
} as never;

const teams = [
  { team_id: "t1", name: "T.V.K", purse_balance: 915_000_000 },
  { team_id: "t2", name: "GUWAHATI MAVERICKS", purse_balance: 1_300_000_000 },
  { team_id: "t99", name: "Not Qualified FC", purse_balance: 1_250_000_000 },
];

function renderConsole(
  franchises: Record<string, string>,
  qualified: string[],
  overrides: Partial<Parameters<typeof ConsoleSaleEntry>[0]> = {},
) {
  const biddingField = buildBiddingField(teams, franchises, new Set(qualified));
  return render(
    <ConsoleSaleEntry
      eventEditionId="e1"
      activePlayer={activePlayer}
      biddingField={biddingField}
      auctionEnded={false}
      ruleSet={{ min_squad_size: 18, max_squad_size: 23, max_overseas: 8 }}
      rosterByTeam={{}}
      {...overrides}
    />,
  );
}

describe("ConsoleSaleEntry — sale selector", () => {
  it("renders the active player and a franchise-worded placeholder", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA", t2: "GUJARAT TITANS" }, ["t1", "t2"]);
    expect(screen.getByText("KL RAHUL")).toBeInTheDocument();
    expect(screen.getByText("Select franchise")).toBeInTheDocument();
  });

  it("shows no warning once the field is qualified and fully aliased", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA", t2: "GUJARAT TITANS" }, ["t1", "t2"]);
    expect(screen.queryByText(/registered name/)).not.toBeInTheDocument();
    expect(screen.queryByText(/qualification decisions/)).not.toBeInTheDocument();
  });

  it("warns, with a count, when some teams still lack an alias", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA" }, ["t1", "t2"]);
    expect(
      screen.getByText(/1 of 2 team is showing a registered name/),
    ).toBeInTheDocument();
  });

  it("warns when the field fell back to seated franchises", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA" }, []);
    expect(screen.getByText(/No Rounds 3 \+ 4 qualification decisions are recorded/)).toBeInTheDocument();
  });

  it("warns loudly when neither gate is configured", () => {
    renderConsole({}, []);
    expect(
      screen.getByText(/all 3 registered teams are listed/),
    ).toBeInTheDocument();
  });

  it("still renders the sale form when the field is empty", () => {
    // A misconfigured gate must not blank the console — the amount field and
    // submit button have to stay usable so the state is diagnosable.
    renderConsole({}, ["nobody"]);
    expect(screen.getByRole("button", { name: "Record sale" })).toBeInTheDocument();
  });

  it("shows the ended-auction notice instead of the form once ended", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA" }, ["t1"], { auctionEnded: true });
    expect(screen.getByText(/The auction has ended/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record sale" })).not.toBeInTheDocument();
  });

  it("posts the team id, not the alias, as the form value", () => {
    const { container } = renderConsole({ t1: "KOCHI TUSKERS KERALA" }, ["t1"]);
    const hidden = container.querySelector('input[name="teamId"]') as HTMLInputElement;
    // Empty until a franchise is picked, but present and named so the server
    // action always receives the id rather than a display label.
    expect(hidden).toBeTruthy();
    expect(hidden.value).toBe("");
  });
});
