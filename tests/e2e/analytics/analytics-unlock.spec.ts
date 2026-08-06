import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * AN-01..08, TEAM-AUC-06. request-analytics-form.tsx gates the "Request
 * analytics" button client-side on `balance < price` (analytics_price from
 * the active auction_rule_set, seeded at 500 — scripts/seed-demo.cjs); an
 * approved request unlocks analytics-module.tsx permanently for that team;
 * a rejected request shows the admin's reason and offers a re-request.
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

test.describe("analytics unlock", () => {
  test("a team with insufficient purse cannot request analytics", async ({ page }) => {
    await loginAsAdmin(page);
    const playerName = await ensureActivePlayer(page);
    await page.goto("/admin/auction/console");
    await expect(page.getByText(playerName)).toBeVisible();

    await page.locator("#sale-team").click();
    const option = page.getByRole("option", { name: /Franchise Foxtrot/ });
    const optionText = await option.innerText();
    await option.click();

    // Deplete Foxtrot's purse down to ~100 (below the seeded analytics_price
    // of 500) in a single sale, rather than needing dozens of sales.
    const balance = Number(optionText.replace(/[^0-9]/g, ""));
    await page.getByLabel("Amount").fill(String(balance - 100));
    await page.getByRole("button", { name: "Record sale" }).click();
    await expect(page.getByText("Sale recorded.")).toBeVisible();

    await loginAsTeam(page, "foxtrot");
    await page.goto("/app/auction/analytics");

    await expect(page.getByText(/is below the analytics price/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Request analytics/ })).toBeDisabled();
  });

  test("admin approves a request; analytics unlocks permanently for that team", async ({ page, browser }) => {
    const teamContext = await browser.newContext();
    const teamPage = await teamContext.newPage();
    await loginAsTeam(teamPage, "golf");
    await teamPage.goto("/app/auction/analytics");
    await teamPage.getByRole("button", { name: /Request analytics/ }).click();
    await expect(teamPage.getByText("Analytics requested.")).toBeVisible();
    await expect(teamPage.getByText("Request pending")).toBeVisible();

    await loginAsAdmin(page);
    await page.goto("/admin/auction/analytics-requests");
    const pendingRow = page.getByRole("row", { name: /Franchise Golf/ }).first();
    await expect(pendingRow).toBeVisible();
    await pendingRow.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Analytics request approved.")).toBeVisible();

    await teamPage.goto("/app/auction/analytics");
    await expect(teamPage.getByRole("heading", { name: "Squad balance & gaps" })).toBeVisible();

    // Permanently unlocked — still there after a fresh navigation.
    await teamPage.goto("/app");
    await teamPage.goto("/app/auction/analytics");
    await expect(teamPage.getByRole("heading", { name: "Squad balance & gaps" })).toBeVisible();

    await teamContext.close();
  });

  test("admin can reject a request with a reason; team can re-request", async ({ page, browser }) => {
    const teamContext = await browser.newContext();
    const teamPage = await teamContext.newPage();
    await loginAsTeam(teamPage, "hotel");
    await teamPage.goto("/app/auction/analytics");
    await teamPage.getByRole("button", { name: /Request analytics/ }).click();
    await expect(teamPage.getByText("Analytics requested.")).toBeVisible();

    await loginAsAdmin(page);
    await page.goto("/admin/auction/analytics-requests");
    const pendingRow = page.getByRole("row", { name: /Franchise Hotel/ }).first();
    await expect(pendingRow).toBeVisible();
    await pendingRow.getByRole("button", { name: "Reject…" }).click();
    await expect(page.getByRole("heading", { name: "Reject analytics request" })).toBeVisible();
    await page.getByLabel("Reason (required)").fill("e2e regression check — not shortlisted");
    const confirmButton = page.getByRole("button", { name: "Confirm rejection" });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();
    await expect(page.getByText("Analytics request rejected.")).toBeVisible();

    await teamPage.goto("/app/auction/analytics");
    await expect(teamPage.getByText("Request rejected")).toBeVisible();
    await expect(teamPage.getByText("e2e regression check — not shortlisted")).toBeVisible();
    await expect(teamPage.getByRole("button", { name: /Request analytics/ })).toBeEnabled();

    await teamContext.close();
  });
});
