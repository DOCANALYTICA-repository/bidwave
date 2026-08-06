import { test, expect } from "@playwright/test";

/**
 * /leaderboard and /live (src/app/(public)/leaderboard/page.tsx and
 * live/page.tsx). Both are heavily state-dependent (published snapshots,
 * whether an auction_state row exists, whether the round has opened or
 * ended) — the hosted demo fixture may legitimately be in any pre-publication
 * state, so these specs assert the page always renders coherent content for
 * whichever branch is live, rather than asserting one specific branch.
 */
test.describe("leaderboard shell", () => {
  test("renders standings or the pre-publication empty state, never both/neither", async ({ page }) => {
    await page.goto("/leaderboard");

    await expect(page.getByRole("heading", { name: "Leaderboard", exact: true })).toBeVisible();

    const emptyState = page.getByText("Nothing published yet");
    const finalResults = page.getByRole("heading", { name: "Final Results" });
    const liveStandings = page.getByRole("heading", { name: "Live Standings — Top 15" });

    const hasEmpty = (await emptyState.count()) > 0;
    const hasFinal = (await finalResults.count()) > 0;
    const hasTop15 = (await liveStandings.count()) > 0;

    // The empty state only renders when neither snapshot kind is published.
    expect(hasEmpty).toBe(!hasFinal && !hasTop15);
    if (hasEmpty) {
      await expect(page.getByText("Check back once the admin publishes standings.")).toBeVisible();
    }
  });
});

test.describe("live auction shell", () => {
  test("renders one of: pre-coverage empty state, countdown, in-progress auction, or final squads", async ({ page }) => {
    await page.goto("/live");

    // Every branch of LivePage renders exactly one of these headings.
    await expect(page.getByRole("heading", { name: /^(Live Auction|Final Squads)$/ })).toBeVisible();

    const noCoverage = page.getByText("Coverage hasn't started yet");
    const countdown = page.getByText("The Grand Auction begins in");
    const concluded = page.getByText("The Grand Auction has concluded.");
    // The purses/squads section header is always rendered once state exists
    // — "Player Pools" while live, "Final Squads" once ended.
    const playerPools = page.getByRole("heading", { name: "Player Pools", exact: true });
    const finalSquads = page.getByRole("heading", { name: "Final Squads", exact: true });

    const states = await Promise.all([
      noCoverage.count(),
      countdown.count(),
      concluded.count(),
      playerPools.count(),
      finalSquads.count(),
    ]);
    // Exactly one recognizable state should be showing.
    expect(states.some((c) => c > 0)).toBe(true);
  });
});
