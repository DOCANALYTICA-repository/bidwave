import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsTeam, teamName } from "../fixtures";

/**
 * QZ-13/docs/QUIZ_LIMITATIONS.md: tab-switch / window-blur is detected via
 * the Page Visibility API — quiz-runner.tsx's onVisibilityChange handler
 * calls finalize('visibility_hidden') the moment `document.hidden` is
 * observed true. This is deliberately narrower than
 * back-button-crash-regression.spec.ts (native back — already covered
 * there) and doesn't attempt the fullscreenchange path, which is flaky
 * under headless automation per the task brief; visibilitychange is
 * synthesized directly instead, which is exactly the signal the handler
 * actually listens for.
 *
 * Uses team "foxtrot" for "The Stat Sprint" — distinct from the "bravo"
 * (back-button-crash-regression.spec.ts) and "delta"
 * (quiz-happy-path.spec.ts) attempts on this same round, since
 * quiz_attempts enforces one attempt per (round, team).
 *
 * This spec asserts the STRICT exit policy (rounds.quiz_exit_policy =
 * 'strict', the default and what The Stat Sprint runs), where the first
 * visibility signal submits immediately. Under the 'lenient' policy used by
 * the re-attempt round the same signal only raises a warning, so if this
 * ever starts failing with a warning overlay instead of the Submitted
 * heading, check the round's policy before touching the assertion.
 */
const ROUND_NAME = "The Stat Sprint";
const TEAM = "foxtrot" as const;

test.describe("quiz exit detection", () => {
  test("simulated tab-switch (visibilitychange) auto-submits the attempt", async ({
    page,
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto("/admin/rounds");
    const row = adminPage.getByRole("row", { name: new RegExp(ROUND_NAME) });
    await row.getByRole("button", { name: "Open now" }).click();
    await expect(row.getByRole("cell").nth(3)).toContainText(/open/i);
    const href = await row.getByRole("link", { name: ROUND_NAME }).getAttribute("href");
    const roundId = href!.split("/admin/rounds/")[1];
    await adminPage.goto(href!);

    // A round with no active question can't be started — make sure at
    // least one exists, reusing whatever quiz-happy-path.spec.ts /
    // back-button-crash-regression.spec.ts may have already added.
    await adminPage.getByRole("tab", { name: "Quiz bank" }).click();
    if ((await adminPage.getByText(/^#0 /).count()) === 0) {
      await adminPage.getByPlaceholder("Option 1").fill("Chennai Super Kings");
      await adminPage.getByPlaceholder("Option 2").fill("Gujarat Titans");
      await adminPage.getByPlaceholder("Option 3").fill("Mumbai Indians");
      await adminPage.getByPlaceholder("Option 4").fill("Rajasthan Royals");
      await adminPage.getByLabel("Prompt").fill("Which team won IPL 2023?");
      await adminPage.getByRole("button", { name: "Add question" }).click();
      await expect(adminPage.getByText(/^#0 /)).toBeVisible();
    }

    await loginAsTeam(page, TEAM);
    await page.goto(`/app/rounds/${roundId}`);
    await page.getByRole("link", { name: "Go to quiz" }).click();
    await page.getByRole("button", { name: "I'm ready — start" }).click();
    await expect(page.getByText(/Question 1 of/)).toBeVisible();

    // Simulate the browser/tab losing visibility — stub document.hidden
    // and dispatch the same event quiz-runner.tsx's onVisibilityChange
    // listens for.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible({ timeout: 15_000 });

    // The exit event must actually be logged (audit high-priority #7 —
    // log_quiz_events() existed but nothing called it), visible to the
    // admin monitor against this exact attempt.
    await adminPage.goto(`/admin/rounds/${roundId}`);
    await adminPage.getByRole("tab", { name: "Quiz bank" }).click();
    const attemptRow = adminPage.locator("li", { hasText: teamName(TEAM) });
    await expect(attemptRow).toContainText("visibility_hidden");

    await adminContext.close();
  });
});
