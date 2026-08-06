import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * R6-04/R6-05: the final Top 10 is an explicit, admin-assembled, ordered
 * array (LeaderboardPublisher, reused from /admin/leaderboard) — never a
 * computed combination of the final-stage aggregate + Round 6 score (see
 * final-results/page.tsx's own "Reference sum (not authoritative)" column,
 * which exists specifically to make that non-authoritative-ness visible).
 * This confirms the admin can pick teams into ranks in an order that does
 * NOT match alphabetical/reference-sum order, and that the publish actually
 * replaces whatever was live before.
 */
test.describe("final results publish", () => {
  test("admin picks and orders teams into an explicit Top 10, then publishes", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/final-results");
    await expect(page.getByRole("heading", { name: "Final results" })).toBeVisible();

    await expect(
      page.getByText("Publish a new ranked list (10 entries, admin-ordered)"),
    ).toBeVisible();

    // Deliberately rank Lima above Alpha — an order no alphabetical or
    // reference-sum formula would ever produce, proving this is a manual
    // admin choice, not a computed one.
    const rank1Select = page.locator("[data-slot=select-trigger]").nth(0);
    await rank1Select.click();
    await page.getByRole("option", { name: /Franchise Lima/ }).click();
    const rank1Score = page.getByPlaceholder("Score").nth(0);
    await rank1Score.fill("99");

    const rank2Select = page.locator("[data-slot=select-trigger]").nth(1);
    await rank2Select.click();
    await page.getByRole("option", { name: /Franchise Alpha/ }).click();
    const rank2Score = page.getByPlaceholder("Score").nth(1);
    await rank2Score.fill("95");

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Leaderboard published.")).toBeVisible();

    // The newly published snapshot is now the live one, in the chosen order.
    await expect(page.getByText(/Published/)).toBeVisible();
    const publishedList = page.locator("ol");
    await expect(publishedList.locator("li").nth(0)).toContainText("Franchise Lima");
    await expect(publishedList.locator("li").nth(0)).toContainText("99");
    await expect(publishedList.locator("li").nth(1)).toContainText("Franchise Alpha");
    await expect(publishedList.locator("li").nth(1)).toContainText("95");
  });
});
