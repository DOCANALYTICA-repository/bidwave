import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * AN-01..08/§17.2: after unlock, analytics-module.tsx must render every
 * section without crashing even when real player performance stats
 * (DEP-05) are absent — seeded players carry empty `stats` (scripts/
 * seed-demo.cjs never populates it), so this exercises the actual
 * graceful-degradation path (hasRealValueSignal = false), not a mocked one.
 * Self-contained: requests + approves analytics for a fresh team rather
 * than depending on analytics-unlock.spec.ts having already run.
 */
test.describe("analytics module", () => {
  test("renders every section without an error boundary, with no real stats present", async ({ page, browser }) => {
    const teamContext = await browser.newContext();
    const teamPage = await teamContext.newPage();
    await loginAsTeam(teamPage, "india");
    await teamPage.goto("/app/auction/analytics");

    // Only request if not already unlocked/pending from a prior run.
    const requestButton = teamPage.getByRole("button", { name: /Request analytics/ });
    if ((await requestButton.count()) > 0) {
      await requestButton.click();
      await expect(teamPage.getByText("Analytics requested.")).toBeVisible();

      await loginAsAdmin(page);
      await page.goto("/admin/auction/analytics-requests");
      const pendingRow = page.getByRole("row", { name: /Franchise India/ }).first();
      await expect(pendingRow).toBeVisible();
      await pendingRow.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByText("Analytics request approved.")).toBeVisible();

      await teamPage.goto("/app/auction/analytics");
    }

    const errors: string[] = [];
    teamPage.on("pageerror", (err) => errors.push(err.message));

    await teamPage.reload();

    // Every section heading from analytics-module.tsx's Section() calls.
    await expect(teamPage.getByRole("heading", { name: "Squad balance & gaps" })).toBeVisible();
    await expect(teamPage.getByRole("heading", { name: "Rule compliance" })).toBeVisible();
    await expect(teamPage.getByRole("heading", { name: "Purse-aware affordable targets" })).toBeVisible();
    await expect(teamPage.getByRole("heading", { name: "Undervalued-player opportunities" })).toBeVisible();
    await expect(teamPage.getByRole("heading", { name: "Player profiles & head-to-head" })).toBeVisible();

    // hasRealValueSignal is false against seeded data (no numeric stats
    // populated anywhere) — the undervalued section must degrade to this
    // exact EmptyState, never fabricate a value signal from price alone.
    await expect(teamPage.getByText("Needs player performance data")).toBeVisible();

    expect(errors, `Uncaught page errors rendering the analytics module: ${errors.join("; ")}`).toEqual([]);

    await teamContext.close();
  });
});
