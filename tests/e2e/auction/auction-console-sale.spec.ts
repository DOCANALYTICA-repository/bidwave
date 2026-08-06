import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * AUC-08..20: record a sale within limits, then force a specific rejection
 * (insufficient purse) and assert on record_sale()'s actual exception text
 * (supabase/migrations/20260730080000_auction.sql's `[sale_blocked] % '
 * rule(s) violated.` message, surfaced via console-sale-entry.tsx's
 * humanizeViolation() as "insufficient_purse — balance: X, amount: Y").
 */

/** Ensures some player is "active" (up for bidding) and returns its name.
 * Reuses whichever player is already active if one exists — auction_state
 * only ever has one active player per edition (players_one_active_per_edition),
 * so this must not blindly activate a second one. */
async function ensureActivePlayer(page: Page): Promise<string> {
  await page.goto("/admin/auction/players");
  const activeRow = page.getByRole("row", { name: /Active/ }).first();
  if ((await activeRow.count()) > 0) {
    return (await activeRow.getByRole("cell").first().innerText()).trim();
  }
  const availableRow = page.getByRole("row", { name: /Available/ }).first();
  await availableRow.getByRole("button", { name: "Set active" }).click();
  await expect(page.getByRole("row", { name: /Active/ }).first()).toBeVisible();
  return (await page.getByRole("row", { name: /Active/ }).first().getByRole("cell").first().innerText()).trim();
}

async function clearActivePlayer(page: Page) {
  await page.goto("/admin/auction/console");
  const markUnsoldButton = page.getByRole("button", { name: "Mark unsold" });
  if ((await markUnsoldButton.count()) > 0) {
    await markUnsoldButton.click();
    await expect(page.getByText("No player is currently active.")).toBeVisible();
  }
}

test.describe("auction console — record sale", () => {
  test("records a valid sale within limits", async ({ page }) => {
    await loginAsAdmin(page);
    const playerName = await ensureActivePlayer(page);

    await page.goto("/admin/auction/console");
    await expect(page.getByText(playerName)).toBeVisible();

    await page.locator("#sale-team").click();
    await page.getByRole("option", { name: /Franchise Alpha/ }).click();

    await page.getByRole("button", { name: "Record sale" }).click();
    await expect(page.getByText("Sale recorded.")).toBeVisible();

    // The sales log's newest row reflects this sale.
    const salesLogHeading = page.getByRole("heading", { name: "Recent sales" });
    await expect(salesLogHeading).toBeVisible();
    const firstDataRow = page.getByRole("row").filter({ hasText: playerName }).first();
    await expect(firstDataRow).toContainText("Franchise Alpha");
    await expect(firstDataRow).toContainText("Sold");
  });

  test("rejects a sale that exceeds the team's purse balance", async ({ page }) => {
    await loginAsAdmin(page);
    // Whatever was active from the previous test just sold — make sure a
    // fresh player is active for this scenario.
    const playerName = await ensureActivePlayer(page);

    await page.goto("/admin/auction/console");
    await expect(page.getByText(playerName)).toBeVisible();

    await page.locator("#sale-team").click();
    await page.getByRole("option", { name: /Franchise Bravo/ }).click();

    // No team's purse (starting_purse 100,000,000 per scripts/seed-demo.cjs)
    // can possibly cover this — guarantees the [sale_blocked] insufficient
    // purse violation without needing to first deplete a team's balance.
    const amountInput = page.getByLabel("Amount");
    await amountInput.fill("999999999999");

    await page.getByRole("button", { name: "Record sale" }).click();

    // record_sale() raises '[sale_blocked] % rule(s) violated.' — the code
    // prefix is stripped by parseRpcErrorCode, leaving this exact text.
    await expect(page.getByText(/rule\(s\) violated/).first()).toBeVisible();
    // The specific violation, from the exception's DETAIL, humanized by
    // console-sale-entry.tsx's humanizeViolation().
    await expect(page.getByText(/insufficient_purse/).first()).toBeVisible();

    // Confirm no partial write happened — the player must still be active,
    // not sold, and the sales log must not show it.
    await expect(page.getByText(playerName).first()).toBeVisible();
    const rejectedRow = page.getByRole("row").filter({ hasText: playerName });
    await expect(rejectedRow).toHaveCount(0);

    await clearActivePlayer(page);
  });
});
