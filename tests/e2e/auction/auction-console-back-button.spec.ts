import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

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

    await page.goto("/admin/auction/players");
    const activeRow = page.getByRole("row", { name: /Active/ }).first();
    if ((await activeRow.count()) === 0) {
      const availableRow = page.getByRole("row", { name: /Available/ }).first();
      await availableRow.getByRole("button", { name: "Set active" }).click();
      await expect(page.getByRole("row", { name: /Active/ }).first()).toBeVisible();
    }

    await page.goto("/admin/auction/console");
    // Confirms the lock badge's acquire effect actually ran (mounted with a
    // real active player), not just an empty console shell.
    await expect(page.getByText(/No player is currently active/)).toHaveCount(0);

    await page.goBack();
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).not.toBeEmpty();
    expect(errors, `Uncaught page errors during console back-navigation: ${errors.join("; ")}`).toEqual([]);
  });
});
