import { test, expect, type Locator } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * Broader sweep of the `variant="tile"` background-fix (auth-guards.spec.ts
 * only checks one Edit button on /admin/rounds) across every admin page
 * that actually has a tile-variant button — found via
 * `grep -rn 'variant="tile"' src/app/admin`:
 *   - rounds-table.tsx: Edit + the 5 lifecycle actions (Open now, Close
 *     now, Start scoring, Mark scored, Release publicly)
 *   - players-table.tsx: Edit
 *   - leaderboard-publisher.tsx: "Hide current" (only rendered once a
 *     snapshot is published — scripts/seed-demo.cjs publishes a top_15
 *     snapshot, so it's present against the seeded fixture)
 *   - activity-log.tsx: Refresh
 *
 * /admin/teams has no `variant="tile"` buttons at all (teams-table.tsx /
 * team-detail-sheet.tsx use "outline"/default instead) — it's still
 * visited below as a smoke check, without inventing a tile assertion that
 * doesn't apply to it.
 */
async function expectOpaqueBackground(button: Locator) {
  await expect(button).toBeVisible();
  const bg = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(bg).not.toBe("transparent");
}

test.describe("admin tile-button backgrounds are opaque at rest", () => {
  test("rounds: Edit + every lifecycle action button", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/rounds");

    const firstRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Edit" }) }).first();
    await expectOpaqueBackground(firstRow.getByRole("button", { name: "Edit" }));
    for (const label of ["Open now", "Close now", "Start scoring", "Mark scored", "Release publicly"]) {
      await expectOpaqueBackground(firstRow.getByRole("button", { name: label }));
    }
  });

  test("auction players: Edit button", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/auction/players");
    await expectOpaqueBackground(page.getByRole("button", { name: "Edit" }).first());
  });

  test("leaderboard: Hide current button", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/leaderboard");
    const hideButton = page.getByRole("button", { name: "Hide current" }).first();
    await expectOpaqueBackground(hideButton);
  });

  test("activity: Refresh button", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/activity");
    await expectOpaqueBackground(page.getByRole("button", { name: "Refresh" }));
  });

  test("teams: page loads (no tile-variant buttons on this page)", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/teams");
    await expect(page.getByRole("heading", { name: "Teams" }).first()).toBeVisible();
  });
});
