import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

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
 * Native back mid on-spot-simulation console must degrade gracefully (a
 * real dashboard, or TeamAppError's "Try again"/"Back to dashboard" recovery
 * screen — src/app/app/error.tsx), never an uncaught crash — same class of
 * regression as back-button-crash-regression.spec.ts, but targeted at the
 * simulation console specifically.
 */
test.describe("simulation back-button", () => {
  test("native back from /app/simulation does not crash", async ({ page, browser }) => {
    // Make sure the simulation is actually reachable for this team before
    // testing back-navigation away from it.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto("/admin/simulation");
    const toggleButton = adminPage.getByRole("button", { name: /Show to teams|Hide from teams/ });
    await expect(toggleButton).toBeVisible();
    if ((await toggleButton.innerText()) === "Show to teams") {
      await toggleButton.click();
      await expect(adminPage.getByRole("button", { name: "Hide from teams" })).toBeVisible();
    }
    await adminContext.close();

    const errors = collectPageErrors(page);
    await loginAsTeam(page, "charlie");
    await page.goto("/app");
    await page.goto("/app/simulation");
    await expect(page.getByRole("heading", { name: "On-spot simulation" })).toBeVisible();

    await page.goBack();
    await page.waitForLoadState("networkidle");

    // Must still show real content, not a blank/dead tree.
    await expect(page.locator("body")).not.toBeEmpty();
    expect(errors, `Uncaught page errors during simulation back-navigation: ${errors.join("; ")}`).toEqual([]);
  });
});
