import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsTeam, teamName } from "../fixtures";

/**
 * §10 admin quiz controls: quiz-builder.tsx's "Edit" button loads a
 * question back into the form for in-place editing (adminSaveQuizQuestion
 * upserts by questionId, so this must update the existing row, not create
 * a duplicate), the admin monitor lists per-team attempts with their exit
 * event log, and "Reset attempt" (admin_reset_quiz_attempt) archives a
 * stuck in-progress attempt so a fresh one becomes possible.
 *
 * Uses team "golf" — distinct from every other quiz spec's team on "The
 * Stat Sprint" (bravo/delta/foxtrot elsewhere), since quiz_attempts
 * enforces one attempt per (round, team) and this test needs a genuinely
 * fresh, resettable in_progress attempt.
 */
const ROUND_NAME = "The Stat Sprint";
const TEAM = "golf" as const;
const ORIGINAL_PROMPT = "E2E admin spec: original prompt about IPL trophies";
const EDITED_PROMPT = "E2E admin spec: edited prompt about IPL trophies";

test.describe("quiz admin controls", () => {
  test("editing a question updates it in place; Reset attempt archives an in-progress attempt", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/rounds");
    const row = page.getByRole("row", { name: new RegExp(ROUND_NAME) });
    await row.getByRole("button", { name: "Open now" }).click();
    await expect(row.getByRole("cell").nth(3)).toContainText(/open/i);
    const href = await row.getByRole("link", { name: ROUND_NAME }).getAttribute("href");
    const roundId = href!.split("/admin/rounds/")[1];

    await page.getByRole("tab", { name: "Quiz bank" }).click();

    // Add a question, then edit it — must not leave both the old and new
    // prompt visible at once.
    if ((await page.getByText(ORIGINAL_PROMPT).count()) === 0) {
      await page.getByPlaceholder("Option 1").fill("The Mumbai Indians");
      await page.getByPlaceholder("Option 2").fill("The Chennai Super Kings");
      await page.getByPlaceholder("Option 3").fill("The Kolkata Knight Riders");
      await page.getByPlaceholder("Option 4").fill("The Gujarat Titans");
      await page.getByLabel("Prompt").fill(ORIGINAL_PROMPT);
      await page.getByLabel("Timer (seconds)").fill("30");
      await page.getByRole("button", { name: "Add question" }).click();
      await expect(page.getByText(ORIGINAL_PROMPT)).toBeVisible();
    }

    const questionRow = page.locator("li", { hasText: ORIGINAL_PROMPT });
    await questionRow.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Prompt").fill(EDITED_PROMPT);
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText(EDITED_PROMPT)).toBeVisible();
    await expect(page.getByText(ORIGINAL_PROMPT, { exact: true })).toHaveCount(0);
    // Exactly one row for this question, not a duplicate.
    await expect(page.locator("li", { hasText: EDITED_PROMPT })).toHaveCount(1);

    // Make sure the round has at least one active question so a fresh
    // attempt can actually start.
    if ((await page.getByText(/^#0 /).count()) === 0) {
      await page.getByPlaceholder("Option 1").fill("Chennai Super Kings");
      await page.getByPlaceholder("Option 2").fill("Gujarat Titans");
      await page.getByPlaceholder("Option 3").fill("Mumbai Indians");
      await page.getByPlaceholder("Option 4").fill("Rajasthan Royals");
      await page.getByLabel("Prompt").fill("Which team won IPL 2023?");
      await page.getByLabel("Timer (seconds)").fill("60");
      await page.getByRole("button", { name: "Add question" }).click();
    }

    // Start a fresh in-progress attempt to reset.
    const teamContext = await browser.newContext();
    const teamPage = await teamContext.newPage();
    await loginAsTeam(teamPage, TEAM);
    await teamPage.goto(`/app/rounds/${roundId}`);
    await teamPage.getByRole("link", { name: "Go to quiz" }).click();
    await teamPage.getByRole("button", { name: "I'm ready — start" }).click();
    await expect(teamPage.getByText(/Question 1 of/)).toBeVisible();
    await teamContext.close();

    await page.reload();
    await page.getByRole("tab", { name: "Quiz bank" }).click();
    const attemptRow = page.locator("li", { hasText: teamName(TEAM) });
    await expect(attemptRow).toContainText("in_progress");
    await attemptRow.getByRole("button", { name: "Reset attempt" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: `${teamName(TEAM)}'s attempt reset.` }),
    ).toBeVisible();

    // Reset archives the attempt — the admin query excludes archived rows,
    // so this team should no longer appear in the (still in_progress-only
    // reset control) attempts list at all.
    await page.reload();
    await page.getByRole("tab", { name: "Quiz bank" }).click();
    await expect(page.locator("li", { hasText: teamName(TEAM) })).toHaveCount(0);
  });
});
