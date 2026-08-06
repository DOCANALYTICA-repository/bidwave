import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsTeam, TEAM_SLUGS } from "../fixtures";

/**
 * AUC-17..20: reverse one of the ~24 already-seeded sales (scripts/
 * seed-demo.cjs) — deliberately not necessarily the most recent one, per
 * reverse_sale()'s design ("takes a specific p_sale_id, not 'reverse
 * latest'"). Confirms the purse/roster is actually restored, not just that
 * the row's status flips.
 */
function slugFromTeamName(name: string): (typeof TEAM_SLUGS)[number] {
  const word = name.split(" ")[1]?.toLowerCase();
  const slug = TEAM_SLUGS.find((s) => s === word);
  if (!slug) throw new Error(`Could not map team name "${name}" to a known slug`);
  return slug;
}

test.describe("auction console — reverse sale", () => {
  test("reversing a seeded sale restores the player and purse", async ({ page, browser }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/auction/console");

    // Pick the LAST (oldest, since sold_at desc) still-reversible row rather
    // than the newest, matching the "reverse ANY prior sale" contract.
    const reversibleRows = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Reverse…" }) });
    const candidateRow = reversibleRows.last();
    await expect(candidateRow).toBeVisible();

    const cells = candidateRow.getByRole("cell");
    const playerName = (await cells.nth(0).innerText()).trim();
    const teamName = (await cells.nth(1).innerText()).trim();
    const teamSlug = slugFromTeamName(teamName);

    // `reversibleRows.last()` is a dynamic filter (rows that currently have
    // a "Reverse…" button) — once this row is reversed it loses that button
    // and drops OUT of the filter, so re-querying `.last()` afterward would
    // silently resolve to a *different* row. Pin a stable locator by player
    // name instead for every subsequent lookup.
    const targetRow = page.getByRole("row", { name: playerName });

    // Capture the team's roster/purse before reversal, via its own dashboard.
    const teamContext = await browser.newContext();
    const teamPage = await teamContext.newPage();
    await loginAsTeam(teamPage, teamSlug);
    await teamPage.goto("/app/auction");
    await expect(teamPage.getByText(playerName)).toBeVisible();
    const purseBefore = await teamPage.getByText(/^₹/).first().innerText();

    // Reverse it.
    await targetRow.getByRole("button", { name: "Reverse…" }).click();
    await expect(page.getByRole("heading", { name: "Reverse sale" })).toBeVisible();
    await page.getByLabel("Reason (required)").fill("e2e regression check — restoring player/purse");
    const confirmButton = page.getByRole("button", { name: "Confirm reversal" });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();
    await expect(page.getByText("Sale reversed.")).toBeVisible();

    // The row now shows the reversed state.
    await expect(targetRow).toContainText("Reversed");

    // The player is gone from the team's roster and the purse changed.
    await teamPage.goto("/app/auction");
    await expect(teamPage.getByText(playerName)).toHaveCount(0);
    const purseAfter = await teamPage.getByText(/^₹/).first().innerText();
    expect(purseAfter).not.toBe(purseBefore);

    await teamContext.close();
  });
});
