import { test, expect } from "@playwright/test";
import { loginAsAdmin, teamName } from "../fixtures";

/**
 * LDB-04 / FIX_PASS_2_REPORT.md item 17 ("Unpublished scores on live
 * leaderboard"): entering a per-round score is a completely separate
 * action from publishing the public leaderboard snapshot — the public
 * /leaderboard page must not change just because a round score was saved.
 * Publishing (LeaderboardPublisher's "Publish" button -> admin_publish_
 * leaderboard) is the one, distinct, explicit step that changes it, and
 * hiding (admin_hide_leaderboard) reverses that.
 *
 * Uses "The Immersive Challenge" (seq 3) for the round-score half of this
 * test — deliberately not "Operation Fan Heist"/"Crisis Room", which other
 * specs in this directory touch — so this spec's own round-score entry
 * can't collide with a rubric criterion those specs may have added
 * elsewhere. "Franchise India" is used for both halves and isn't
 * referenced by any other spec in this directory.
 */
const ROUND_NAME = "The Immersive Challenge";
const TEAM = "india" as const;
const SCORE_VALUE = "77";

test.describe("leaderboard publish", () => {
  test("a round score alone doesn't move the public leaderboard; publishing does, and hiding reverses it", async ({
    page,
    browser,
  }) => {
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto("/leaderboard");
    const baselineText = await publicPage.locator("body").innerText();

    await loginAsAdmin(page);
    await page.goto("/admin/rounds");
    await page.getByRole("link", { name: ROUND_NAME }).click();
    await page.waitForURL(/\/admin\/rounds\/.+/);
    await page.getByRole("tab", { name: "Scores" }).click();

    const scoreRow = page.getByRole("row", { name: new RegExp(teamName(TEAM)) });
    await expect(scoreRow).toBeVisible();
    // This round has no rubric criteria added by any other spec, so
    // ScoreRow renders the plain total-only input.
    await scoreRow.locator('input[type="number"]').first().fill(SCORE_VALUE);
    await scoreRow.getByRole("button", { name: "Save" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: `Score saved for ${teamName(TEAM)}.` }),
    ).toBeVisible();

    // The public leaderboard must be completely unaffected by that save.
    await publicPage.reload();
    await expect(publicPage.locator("body")).toHaveText(baselineText);

    // Now publish, explicitly — a distinct action.
    await page.goto("/admin/leaderboard");
    const publisherRow = page.locator("div.flex.items-center.gap-2").first();
    await publisherRow.getByRole("combobox").click();
    await page.getByRole("option", { name: new RegExp(teamName(TEAM)) }).click();
    await publisherRow.getByPlaceholder("Score").fill(SCORE_VALUE);
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Leaderboard published." }),
    ).toBeVisible();

    await publicPage.reload();
    const publishedText = await publicPage.locator("body").innerText();
    expect(publishedText).not.toBe(baselineText);
    await expect(publicPage.getByText(teamName(TEAM))).toBeVisible();
    await expect(publicPage.getByRole("heading", { name: /Top 15/ })).toBeVisible();

    // Hiding reverses it.
    await page.reload();
    await page.getByRole("button", { name: "Hide current" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Leaderboard hidden." }),
    ).toBeVisible();

    await publicPage.reload();
    await expect(publicPage.getByRole("heading", { name: /Top 15/ })).toHaveCount(0);

    await publicContext.close();
  });
});
