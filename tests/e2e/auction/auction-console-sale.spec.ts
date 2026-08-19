import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * AUC-08..20: record a sale within limits, then force a specific rejection
 * (insufficient purse) and assert on record_sale()'s actual exception text
 * (supabase/migrations/20260730080000_auction.sql's `[sale_blocked] % '
 * rule(s) violated.` message, surfaced via console-sale-entry.tsx's
 * humanizeViolation() as "insufficient_purse — balance: X, amount: Y").
 *
 * The whole find -> activate -> team -> amount -> confirm loop now lives on the
 * console, driven from the keyboard, because a lot clears every ~40 seconds in
 * the low-value pools. These specs walk it the way the admin does — typing, not
 * clicking between pages — so a regression that costs keystrokes fails here.
 */
const PLAYER_SEARCH = "Search unsold and available players…";

/**
 * Puts a player up for bidding from the console's own search and returns the
 * name picked. `activatePlayerForBidding` closes out whoever was active first,
 * so unlike the old players-tab route this is safe to call unconditionally.
 */
async function putPlayerUp(page: Page): Promise<string> {
  await page.goto("/admin/auction/console");
  const search = page.getByPlaceholder(PLAYER_SEARCH);
  await search.click();
  const firstOption = page.getByRole("option").first();
  await expect(firstOption).toBeVisible();
  // The option's label is the player's name; the muted second line is the pool.
  const name = (await firstOption.locator("span > span").first().innerText()).trim();
  await firstOption.click();
  // The sale form appears optimistically, ahead of the server confirming.
  await expect(page.getByRole("button", { name: "Record sale" })).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
  return name;
}

async function clearActivePlayer(page: Page) {
  await page.goto("/admin/auction/console");
  const markUnsoldButton = page.getByRole("button", { name: "Mark unsold" });
  if ((await markUnsoldButton.count()) > 0) {
    await markUnsoldButton.click();
    await expect(page.getByText("No player is currently up for bidding.")).toBeVisible();
  }
}

test.describe("auction console — record sale", () => {
  test("records a valid sale within limits", async ({ page }) => {
    await loginAsAdmin(page);
    const playerName = await putPlayerUp(page);

    await page.locator("#sale-team").fill("Franchise Alpha");
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

  test("runs the whole loop on the keyboard, in crore", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/auction/console");

    // Player: type, Enter. Focus must land on the franchise field by itself —
    // a lost focus handoff here is the exact cost this workflow removes.
    const search = page.getByPlaceholder(PLAYER_SEARCH);
    await search.click();
    const playerName = (
      await page.getByRole("option").first().locator("span > span").first().innerText()
    ).trim();
    await search.press("Enter");
    await expect(page.locator("#sale-team")).toBeFocused();

    // Franchise: type, Enter. Focus moves on to the amount, pre-selected so
    // the first keystroke replaces the prefilled base price.
    await page.locator("#sale-team").fill("Franchise Alpha");
    await page.locator("#sale-team").press("Enter");
    const amount = page.getByLabel("Amount");
    await expect(amount).toBeFocused();

    // Amount is crore against a fixed suffix: 0.4 is ₹40,00,000. Enter submits.
    await amount.fill("0.4");
    await amount.press("Enter");
    await expect(page.getByText("Sale recorded.")).toBeVisible();

    // Exactly one row: a duplicated dispatch would put the same lot in the log
    // twice, which is how the double-toast bug first showed up.
    const soldRows = page.getByRole("row").filter({ hasText: playerName });
    await expect(soldRows).toHaveCount(1);
    await expect(soldRows.first()).toContainText("Franchise Alpha");
    // 0.4 in the crore field must reach the server as ₹40,00,000. The log
    // prints the exact figure (it is an audit trail), so this is the assertion
    // that the crore -> rupee conversion is not off by a factor of ten.
    await expect(soldRows.first()).toContainText("₹40,00,000");

    // And the console has reset itself back to the search for the next lot.
    await expect(page.getByPlaceholder(PLAYER_SEARCH)).toBeFocused();
  });

  test("rejects a sale that exceeds the team's purse balance", async ({ page }) => {
    await loginAsAdmin(page);
    const playerName = await putPlayerUp(page);

    await page.locator("#sale-team").fill("Franchise Bravo");
    await page.getByRole("option", { name: /Franchise Bravo/ }).click();

    // No team's purse (starting_purse 100,000,000 = 10cr per
    // scripts/seed-demo.cjs) can possibly cover 9999cr — guarantees the
    // [sale_blocked] insufficient purse violation without needing to first
    // deplete a team's balance.
    await page.getByLabel("Amount").fill("9999");

    await page.getByRole("button", { name: "Record sale" }).click();

    // record_sale() raises '[sale_blocked] % rule(s) violated.' — the code
    // prefix is stripped by parseRpcErrorCode, leaving this exact text.
    await expect(page.getByText(/rule\(s\) violated/).first()).toBeVisible();
    // The specific violation, from the exception's DETAIL, humanized by
    // console-sale-entry.tsx's humanizeViolation().
    await expect(page.getByText(/insufficient_purse/).first()).toBeVisible();

    // Confirm no partial write happened — the player must still be up for
    // bidding, not sold, and the sales log must not show it.
    await expect(page.getByText(playerName).first()).toBeVisible();
    const rejectedRow = page.getByRole("row").filter({ hasText: playerName });
    await expect(rejectedRow).toHaveCount(0);

    await clearActivePlayer(page);
  });

  test("refuses a non-numeric amount without reaching the server", async ({ page }) => {
    await loginAsAdmin(page);
    await putPlayerUp(page);

    await page.locator("#sale-team").fill("Franchise Alpha");
    await page.getByRole("option", { name: /Franchise Alpha/ }).click();

    const amount = page.getByLabel("Amount");
    // The unit is part of the field, so typing it is the mistake to catch.
    await amount.fill("5.5 Cr");
    await expect(amount).toHaveAttribute("aria-invalid", "true");

    await clearActivePlayer(page);
  });
});
