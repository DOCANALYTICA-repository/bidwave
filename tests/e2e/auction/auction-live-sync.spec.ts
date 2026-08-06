import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * LIVE-01..08/TEAM-AUC-02: principle #5 — realtime carries no private data,
 * clients refetch through an authorized endpoint after a topic ping
 * (live-realtime.tsx / team-auction-realtime.tsx both call
 * useLiveBroadcast(..., "auction", () => router.refresh())). This confirms
 * both the public /live feed and the affected team's own /app/auction page
 * pick up a sale recorded from a separate admin session, without a manual
 * page reload.
 */
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

test.describe("auction live sync", () => {
  test("a sale recorded by admin appears on /live and the team's /app/auction without a manual refresh", async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);
    const playerName = await ensureActivePlayer(adminPage);

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto("/live");

    const teamContext = await browser.newContext();
    const teamPage = await teamContext.newPage();
    await loginAsTeam(teamPage, "charlie");
    await teamPage.goto("/app/auction");
    await expect(teamPage.getByText(playerName)).toHaveCount(0);

    await adminPage.goto("/admin/auction/console");
    await expect(adminPage.getByText(playerName)).toBeVisible();
    await adminPage.locator("#sale-team").click();
    await adminPage.getByRole("option", { name: /Franchise Charlie/ }).click();
    await adminPage.getByRole("button", { name: "Record sale" }).click();
    await expect(adminPage.getByText("Sale recorded.")).toBeVisible();

    // Neither of these pages is manually reloaded — the realtime topic ping
    // + refetch must be what surfaces the new sale.
    await expect(publicPage.getByText(`${playerName} → Franchise Charlie`)).toBeVisible({ timeout: 20_000 });
    await expect(teamPage.getByText(playerName)).toBeVisible({ timeout: 20_000 });

    await adminContext.close();
    await publicContext.close();
    await teamContext.close();
  });
});
