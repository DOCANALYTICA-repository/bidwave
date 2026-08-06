import { test, expect } from "@playwright/test";
import { loginAsAdmin, teamName } from "../fixtures";

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

    // admin_publish_leaderboard() rejects a final_top_10 snapshot unless it
    // has exactly 10 entries ("[invalid_final_top_10] ... must have exactly
    // 10 entries") — confirmed by direct reproduction. Fill all 10 slots.
    // Ranks 1-2 deliberately rank Lima above Alpha — an order no
    // alphabetical or reference-sum formula would ever produce, proving
    // this is a manual admin choice, not a computed one.
    const rankedTeams = ["lima", "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india"] as const;
    for (let i = 0; i < rankedTeams.length; i++) {
      const select = page.locator("[data-slot=select-trigger]").nth(i);
      await select.click();
      await page.getByRole("option", { name: new RegExp(teamName(rankedTeams[i])) }).click();
      await page.getByPlaceholder("Score").nth(i).fill(String(100 - i * 3));
    }

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Leaderboard published.")).toBeVisible();

    // The newly published snapshot is now the live one, in the chosen order.
    await expect(page.getByText(/Published/)).toBeVisible();
    const publishedList = page.locator("ol");
    await expect(publishedList.locator("li").nth(0)).toContainText("Franchise Lima");
    await expect(publishedList.locator("li").nth(0)).toContainText("100");
    await expect(publishedList.locator("li").nth(1)).toContainText("Franchise Alpha");
    await expect(publishedList.locator("li").nth(1)).toContainText("97");
  });
});
