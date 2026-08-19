import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, putPlayerUpForBidding } from "../fixtures";

// Same benign Next.js dev-mode performance-marker noise filtered out by
// tests/e2e/regression/back-button-crash-regression.spec.ts.
const BENIGN_DEV_NOISE = /cannot have a negative time stamp/;

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    if (!BENIGN_DEV_NOISE.test(err.message)) errors.push(err.message);
  });
  return errors;
}

/**
 * Narrower than back-button-crash-regression.spec.ts's broad admin
 * back/forward sweep (which visits /admin/auction/console but with no
 * player active): this specifically exercises console-lock-badge.tsx's
 * mount/unmount lock-acquire/release effect, which only runs while a
 * player is actually active in the console.
 */
test.describe("auction console back-button with an active player", () => {
  test("native back away from the console with a player active does not crash", async ({ page }) => {
    const errors = collectPageErrors(page);
    await loginAsAdmin(page);

    // Land on the Players tab first so `goBack()` has somewhere real to go —
    // putPlayerUpForBidding navigates straight to the console, and without a
    // prior entry the back step lands on about:blank.
    await page.goto("/admin/auction/players");
    await putPlayerUpForBidding(page);
    // Confirms the lock badge's acquire effect actually ran (mounted with a
    // real active player), not just an empty console shell.
    await expect(page.getByText(/No player is currently up for bidding/)).toHaveCount(0);

    await page.goBack();
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).not.toBeEmpty();
    expect(errors, `Uncaught page errors during console back-navigation: ${errors.join("; ")}`).toEqual([]);
  });
});
