import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  activatePlayerForBidding: vi.fn(() => Promise.resolve({})),
  markPlayerUnsold: vi.fn(),
  endAuction: vi.fn(),
}));
vi.mock("@/app/admin/auction/console/console-lock-badge", () => ({
  ConsoleLockBadge: () => null,
}));

const { ConsoleSaleEntry } = await import(
  "@/app/admin/auction/console/console-sale-entry"
);
const { activatePlayerForBidding, recordSale } = await import(
  "@/app/admin/auction/console/actions"
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

// The console's own player search — activatable lots, sent down whole.
const openPlayers = [
  {
    id: "p2",
    full_name: "RIYAN PARAG",
    role: "ALL ROUNDER",
    pool: "POT 14 · CAPPED ALLROUNDERS",
    base_price: 10_000_000,
    status: "available" as const,
    is_overseas: false,
    updated_at: "2026-08-18T05:38:02.009Z",
  },
  {
    id: "p3",
    full_name: "RAHMANULLAH GURBAZ",
    role: "WICKET KEEPER",
    pool: "POT 10 · CAPPED WICKET KEEPERS - 2",
    base_price: 15_000_000,
    status: "unsold" as const,
    is_overseas: true,
    updated_at: "2026-08-18T05:38:02.009Z",
  },
];

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
      openPlayers={openPlayers}
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
    // The franchise field is a type-to-filter combobox now; its franchise
    // wording lives in the placeholder rather than a rendered value node.
    expect(screen.getByPlaceholderText("Select franchise")).toBeInTheDocument();
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

// @testing-library/user-event is not a dependency here, so keystrokes are
// driven with fireEvent. The combobox only reads `value` and `key`, so this is
// a faithful enough stand-in.
const PLAYER_SEARCH = "Search unsold and available players…";
function type(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

describe("ConsoleSaleEntry — putting a player up for bidding", () => {
  it("offers available and unsold players in the console's own search", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA" }, ["t1"]);
    fireEvent.focus(screen.getByPlaceholderText(PLAYER_SEARCH));
    expect(screen.getByRole("option", { name: /RIYAN PARAG/ })).toBeInTheDocument();
    // An unsold lot coming back round is offered too, flagged as such —
    // activatePlayerForBidding recalls it on the way to 'active'.
    expect(screen.getByRole("option", { name: /RAHMANULLAH GURBAZ/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /UNSOLD, back round/ })).toBeInTheDocument();
  });

  it("filters on a mid-name word, not just a leading prefix", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA" }, ["t1"]);
    type(screen.getByPlaceholderText(PLAYER_SEARCH), "parag");
    expect(screen.getByRole("option", { name: /RIYAN PARAG/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /GURBAZ/ })).not.toBeInTheDocument();
  });

  it("never lists the player already under the hammer", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA" }, ["t1"], {
      openPlayers: [...openPlayers, { ...openPlayers[0], id: "p1", full_name: "KL RAHUL" }],
    });
    type(screen.getByPlaceholderText(PLAYER_SEARCH), "rahul");
    expect(screen.queryByRole("option", { name: /KL RAHUL/ })).not.toBeInTheDocument();
  });

  it("activates the highlighted player on Enter without submitting the sale form", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA" }, ["t1"]);
    const search = screen.getByPlaceholderText(PLAYER_SEARCH);
    type(search, "riyan");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(activatePlayerForBidding).toHaveBeenCalledWith("p2", openPlayers[0].updated_at);
    expect(recordSale).not.toHaveBeenCalled();
  });
});

describe("ConsoleSaleEntry — crore amount field", () => {
  it("prefills the base price in crore against a fixed Cr suffix", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA" }, ["t1"]);
    // 20000000 rupees is 2 crore — the field carries the bare number only.
    expect(screen.getByLabelText("Amount")).toHaveValue("2");
    expect(screen.getByLabelText("Amount")).toHaveAttribute("name", "amountCrore");
    expect(screen.getByText("Cr")).toBeInTheDocument();
  });

  it("flags a non-numeric amount before it can be submitted", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA" }, ["t1"]);
    const amount = screen.getByLabelText("Amount");
    type(amount, "5.5cr");
    expect(amount).toHaveAttribute("aria-invalid", "true");
    type(amount, "5.5");
    expect(amount).toHaveAttribute("aria-invalid", "false");
  });

  it("keeps Record sale unavailable until a franchise is chosen", () => {
    renderConsole({ t1: "KOCHI TUSKERS KERALA" }, ["t1"]);
    expect(screen.getByRole("button", { name: "Record sale" })).toBeDisabled();
  });
});
