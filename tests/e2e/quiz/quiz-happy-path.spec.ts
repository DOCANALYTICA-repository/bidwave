import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, loginAsTeam, teamName } from "../fixtures";

/**
 * §10 quiz happy path: admin adds real questions to "The Stat Sprint" via
 * the Quiz bank tab, a team runs a full attempt end to end, and it reaches
 * "Submitted" with a recorded score.
 *
 * The runner has no "Next" — get_quiz_state() derives the current question
 * purely from started_at + a snapshotted timer-duration prefix sum
 * (docs/QUIZ_LIMITATIONS.md), so this test uses short (minimum-allowed,
 * 5s) timers and just answers whichever question is on screen as the
 * server clock advances, rather than trying to drive advancement itself.
 *
 * Uses team "delta" — distinct from the "bravo" attempt
 * back-button-crash-regression.spec.ts creates for this same round, since
 * quiz_attempts has a hard one-per-(round,team) uniqueness constraint.
 */
const ROUND_NAME = "The Stat Sprint";
const TEAM = "delta" as const;
const QUESTION_PROMPT_1 = "E2E happy path: which format does the IPL use?";
const QUESTION_PROMPT_2 = "E2E happy path: how many overs per innings in T20?";

async function addQuestionIfMissing(
  adminPage: Page,
  prompt: string,
  options: [string, string, string, string],
) {
  if ((await adminPage.getByText(prompt).count()) > 0) return;
  // QuizBuilder clears the form in a useEffect once the save succeeds,
  // which lands after the server round-trip — filling the next question as
  // soon as the previous one shows up in the list races that reset and the
  // typed values get wiped, so the submit goes out blank.
  await expect(adminPage.getByLabel("Prompt")).toHaveValue("");
  await adminPage.getByPlaceholder("Option 1").fill(options[0]);
  await adminPage.getByPlaceholder("Option 2").fill(options[1]);
  await adminPage.getByPlaceholder("Option 3").fill(options[2]);
  await adminPage.getByPlaceholder("Option 4").fill(options[3]);
  await adminPage.getByLabel("Prompt").fill(prompt);
  await adminPage.getByLabel("Timer (seconds)").fill("5");
  await adminPage.getByLabel("Weight").fill("1");
  await adminPage.getByRole("button", { name: "Add question" }).click();
  await expect(adminPage.getByText(prompt)).toBeVisible();
}

async function playQuizToCompletion(page: Page) {
  await expect(page.getByText(/Question \d+ of \d+/)).toBeVisible();
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if ((await page.getByRole("heading", { name: "Submitted" }).count()) > 0) return;
    // Options render as the only buttons inside this specific wrapper
    // (quiz-runner.tsx) while a question is active.
    const firstOption = page.locator("div.space-y-2 > button").first();
    if ((await firstOption.count()) > 0) {
      await firstOption.click().catch(() => undefined);
    }
    await page.waitForTimeout(500);
  }
  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
}

test.describe("quiz happy path", () => {
  test("admin builds a real quiz bank; a team completes the attempt and reaches Submitted with a score", async ({
    page,
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto("/admin/rounds");
    const row = adminPage.getByRole("row", { name: new RegExp(ROUND_NAME) });
    // open_now is idempotent (unconditional unless already closed).
    await row.getByRole("button", { name: "Open now" }).click();
    await expect(row.getByRole("cell").nth(3)).toContainText(/open/i);

    const href = await row.getByRole("link", { name: ROUND_NAME }).getAttribute("href");
    const roundId = href!.split("/admin/rounds/")[1];
    await adminPage.goto(href!);

    await adminPage.getByRole("tab", { name: "Quiz bank" }).click();
    await addQuestionIfMissing(adminPage, QUESTION_PROMPT_1, [
      "Test cricket",
      "T20",
      "One Day",
      "T10",
    ]);
    await addQuestionIfMissing(adminPage, QUESTION_PROMPT_2, ["16", "18", "20", "22"]);
    // Mark the first option correct on each — the radio defaults to option
    // 1 already, matching the BLANK_OPTIONS default in quiz-builder.tsx.

    await loginAsTeam(page, TEAM);
    await page.goto(`/app/rounds/${roundId}`);
    await page.getByRole("link", { name: "Go to quiz" }).click();
    await page.getByRole("button", { name: "I'm ready — start" }).click();

    await playQuizToCompletion(page);
    // The end screen now explains WHY the attempt ended and shows a receipt
    // (20260814050000). Reaching here by running the clock out submits with
    // reason 'completed' (or 'timeout' if the cron backstop got there
    // first) — both render the same line.
    await expect(page.getByText("Time ran out and your attempt was submitted automatically.")).toBeVisible();
    await expect(page.getByText("Questions answered")).toBeVisible();
    // Scores stay release-gated: the receipt must never leak one.
    await expect(
      page.getByText("Your score will appear on your dashboard once it is released by the admin."),
    ).toBeVisible();

    // Confirm the admin monitor recorded a real score for this attempt, not
    // just a "submitted" status with nothing behind it.
    await adminPage.goto(`/admin/rounds/${roundId}`);
    await adminPage.getByRole("tab", { name: "Quiz bank" }).click();
    await expect(
      adminPage.getByText(new RegExp(`${teamName(TEAM)} — submitted \\(\\d+(\\.\\d+)?/\\d+(\\.\\d+)?\\)`)),
    ).toBeVisible();

    await adminContext.close();
  });
});
