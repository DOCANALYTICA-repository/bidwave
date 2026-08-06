import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * QZ-15: quiz_attempts has a unique index on (round_id, team_id) for every
 * non-archived row — start_quiz_attempt() fails at the database level on a
 * second concurrent start, not just via application logic
 * (docs/QUIZ_LIMITATIONS.md, "One attempt, ever"). This reproduces that
 * with two separate logged-in sessions for the same team (two
 * browser.newContext()s, same credentials — fixtures.ts has no
 * storageState capture, so each context just logs in independently rather
 * than sharing cookies).
 *
 * Uses team "india" — distinct from every other quiz spec's team on "The
 * Stat Sprint" (bravo/delta/foxtrot/golf elsewhere).
 */
const ROUND_NAME = "The Stat Sprint";
const TEAM = "india" as const;

test.describe("quiz second device", () => {
  test("a second concurrent start_quiz_attempt for the same team is rejected", async ({
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
    await adminContext.close();

    const firstContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    await loginAsTeam(firstPage, TEAM);
    await firstPage.goto(`/app/rounds/${roundId}`);
    await firstPage.getByRole("link", { name: "Go to quiz" }).click();
    await firstPage.getByRole("button", { name: "I'm ready — start" }).click();
    await expect(firstPage.getByText(/Question 1 of/)).toBeVisible();

    // A second, entirely separate session for the same team — same
    // credentials, a fresh context so it doesn't share the first
    // session's cookies.
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await loginAsTeam(secondPage, TEAM);
    await secondPage.goto(`/app/rounds/${roundId}`);
    await secondPage.getByRole("link", { name: "Go to quiz" }).click();
    await secondPage.getByRole("button", { name: "I'm ready — start" }).click();

    // start_quiz_attempt()'s unique_violation handler raises
    // '[attempt_already_exists] A quiz attempt already exists for your
    // team.' — QuizRunner surfaces this on its full-page error state.
    await expect(secondPage.getByText("A quiz attempt already exists for your team.")).toBeVisible();
    // The second session must not have been allowed into the attempt.
    await expect(secondPage.getByText(/Question 1 of/)).toHaveCount(0);

    await firstContext.close();
    await secondContext.close();
  });
});
