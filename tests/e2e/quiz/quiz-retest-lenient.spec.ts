import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, loginAsTeam, teamName } from "../fixtures";

/**
 * The Round 1 re-attempt (migration 20260814050000), driven entirely
 * through the admin UI so the spec is self-contained — it builds its own
 * lenient, invite-only round rather than depending on the seeded six.
 *
 * Covers the three things that actually went wrong on the night, each of
 * which is a regression test for a real reported failure:
 *
 *   1. Questions stopped advancing when a per-question timer expired. The
 *      runner used to learn about advancement only from a 2.5s poll, and a
 *      single transient RPC error froze it permanently. Now a local
 *      deadline watcher refetches the instant the server-corrected clock
 *      passes closes_at.
 *   2. Leaving the quiz submitted the attempt outright. Under 'lenient' the
 *      first departure only warns; the second ends it.
 *   3. A refresh submitted the attempt with whatever had been answered (one
 *      real team ended up with zero answers). Now it resumes.
 *
 * Uses team "golf" — every other seeded team is spoken for by the specs on
 * The Stat Sprint, and quiz_attempts is unique per (round, team).
 */
const TEAM = "golf" as const;

/**
 * Each test builds its OWN round: rounds.slug is unique per edition and
 * quiz_attempts is unique per (round, team), so sharing one round across
 * these three would collide on both.
 *
 * The SEQUENCE has to be unique too, and unique across runs — rounds are
 * structural data that global-setup's unseed/seed cycle does not clear (it
 * only resets teams), so every previous run's rounds are still sitting in
 * the e2e-test edition. A fixed sequence passes once and then fails forever
 * on `(event_edition_id, sequence)`.
 */
function uniqueRound(tag: string) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    title: `E2E Retest ${tag} ${stamp}`,
    slug: `e2e-retest-${tag}-${stamp}`,
    sequence: 1000 + Math.floor(Math.random() * 1_000_000),
  };
}

async function addQuestion(adminPage: Page, prompt: string, options: [string, string, string, string]) {
  // QuizBuilder clears the whole form in a useEffect once the save
  // succeeds, and that fires after the server round-trip — so typing the
  // next question the instant the previous one appears in the list races
  // the reset and gets silently wiped. Wait for the blank form first.
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

/**
 * Builds a fresh quiz round through the real admin form and returns its id.
 * `Kind` is a Base UI Select, not a native <select> (see CLAUDE.md), so it
 * has to be driven by clicking the trigger and then the option —
 * selectOption() silently does nothing against it.
 */
async function createRetestRound(
  adminPage: Page,
  round: { title: string; slug: string; sequence: number },
): Promise<string> {
  await adminPage.goto("/admin/rounds");
  await adminPage.getByRole("button", { name: "New round" }).click();

  // Kind FIRST. It's a Base UI Select whose onValueChange re-renders
  // RoundFormContent, and that wipes the uncontrolled Title/Slug/Sequence
  // inputs back to their defaults — filling them first meant submitting a
  // blank slug at sequence 1, which collides with The Stat Sprint and fails
  // with "A round with this slug or sequence already exists."
  await adminPage.getByLabel("Kind").click();
  await adminPage.getByRole("option", { name: "quiz", exact: true }).click();

  await adminPage.getByLabel("Title").fill(round.title);
  await adminPage.getByLabel("Slug").fill(round.slug);
  await adminPage.getByLabel("Sequence").fill(String(round.sequence));
  await adminPage.getByRole("button", { name: "Save round" }).click();
  await expect(adminPage.getByText("Saved.", { exact: true })).toBeVisible();

  // The sheet stays open after a successful save, and while it does the
  // rounds table behind it is outside the accessibility tree — getByRole
  // can't see the new row until this is dismissed.
  await adminPage.getByRole("button", { name: "Close" }).click();
  await expect(adminPage.getByRole("dialog", { name: "New round" })).toHaveCount(0);

  const row = adminPage.getByRole("row", { name: new RegExp(round.title) });
  await expect(row).toBeVisible();
  const href = await row.getByRole("link", { name: round.title }).getAttribute("href");
  return href!.split("/admin/rounds/")[1]!;
}

test.describe("quiz re-attempt (lenient exit policy)", () => {
  test("warns on first exit, resumes after a refresh, and submits on the second exit", async ({
    page,
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);

    const round = uniqueRound("exit");
    const roundId = await createRetestRound(adminPage, round);
    await adminPage.goto(`/admin/rounds/${roundId}`);

    // Policy: lenient, one warning then submit, invite-only.
    await adminPage.getByRole("tab", { name: "Round policy" }).click();
    await adminPage.getByLabel("Exit policy").selectOption("lenient");
    await adminPage.getByLabel("Exits before auto-submit").fill("2");
    await adminPage.getByLabel("Invite only").check();
    await adminPage.getByRole("button", { name: "Save round policy" }).click();
    await expect(adminPage.getByText("Saved.", { exact: true })).toBeVisible();

    // Long timers so the attempt can't run out from under the exit assertions.
    await adminPage.getByRole("tab", { name: "Quiz bank" }).click();
    await adminPage.getByPlaceholder("Option 1").fill("Chennai Super Kings");
    await adminPage.getByPlaceholder("Option 2").fill("Gujarat Titans");
    await adminPage.getByPlaceholder("Option 3").fill("Mumbai Indians");
    await adminPage.getByPlaceholder("Option 4").fill("Rajasthan Royals");
    await adminPage.getByLabel("Prompt").fill("Retest: which team won IPL 2023?");
    await adminPage.getByLabel("Timer (seconds)").fill("600");
    await adminPage.getByRole("button", { name: "Add question" }).click();
    await expect(adminPage.getByText(/^#0 /)).toBeVisible();

    // Invite-only with an empty allowlist: the team can't even see it yet.
    await page.context().addCookies([]);
    await loginAsTeam(page, TEAM);
    await page.goto("/app");
    await expect(page.getByText(round.title)).toHaveCount(0);

    await adminPage.getByRole("tab", { name: "Eligibility" }).click();
    await adminPage
      .getByRole("checkbox", { name: `Allow ${teamName(TEAM)} to take this round` })
      .check();
    await adminPage.getByRole("button", { name: "Save eligibility list" }).click();
    await expect(adminPage.getByText(/team\(s\) can take this round/)).toBeVisible();

    await adminPage.goto("/admin/rounds");
    const row = adminPage.getByRole("row", { name: new RegExp(round.title) });
    await row.getByRole("button", { name: "Open now" }).click();
    await expect(row.getByRole("cell").nth(3)).toContainText(/open/i);

    // ---- the team's attempt -------------------------------------------
    await page.goto("/app");
    await expect(page.getByText(round.title)).toBeVisible();
    await page.goto(`/app/quiz/${roundId}`);
    // The preflight must state the lenient rules explicitly — the whole
    // point is that nobody can claim they weren't told.
    await expect(page.getByText(/Refreshing or closing this page is safe/)).toBeVisible();
    await expect(page.getByText(/You do not need to be in fullscreen/)).toBeVisible();
    await page.getByRole("button", { name: "I'm ready — start" }).click();
    await expect(page.getByText(/Question 1 of/)).toBeVisible();

    await page.locator("div.space-y-2 > button").first().click();
    await expect(page.getByText("1 answered")).toBeVisible();

    // (2) First departure: warning, NOT a submission.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("alertdialog")).toContainText("You left the quiz.");
    await expect(page.getByRole("heading", { name: "Submitted" })).toHaveCount(0);

    // (3) The warning is server-held, so it survives a reload — and the
    // reload resumes the attempt instead of ending it.
    await page.reload();
    await expect(page.getByText(/Question 1 of/)).toBeVisible();
    await expect(page.getByRole("alertdialog")).toContainText("You left the quiz.");
    await page.getByRole("button", { name: "I understand — continue" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    // The answer given before the reload is still selected.
    await expect(page.getByText("1 answered")).toBeVisible();

    // (2b) Second departure ends it. Past the 3s server-side debounce, which
    // exists so one physical alt-tab can't burn both strikes at once.
    await page.waitForTimeout(3500);
    // The reload above threw away the document.hidden stub, so it has to be
    // re-installed — without it the handler sees a VISIBLE page and treats
    // the event as a return-to-foreground resync rather than a departure.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Your attempt ended because you left the quiz.")).toBeVisible();
    await expect(page.getByText("Questions answered")).toBeVisible();

    await adminContext.close();
  });

  test("questions advance on their own when the timer expires", async ({ page, browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);

    const round = uniqueRound("advance");
    const roundId = await createRetestRound(adminPage, round);
    await adminPage.goto(`/admin/rounds/${roundId}`);
    await adminPage.getByRole("tab", { name: "Round policy" }).click();
    await adminPage.getByLabel("Exit policy").selectOption("lenient");
    await adminPage.getByRole("button", { name: "Save round policy" }).click();
    await expect(adminPage.getByText("Saved.", { exact: true })).toBeVisible();

    await adminPage.getByRole("tab", { name: "Quiz bank" }).click();
    await addQuestion(adminPage, "Retest advance Q1", ["A", "B", "C", "D"]);
    await addQuestion(adminPage, "Retest advance Q2", ["A", "B", "C", "D"]);
    await addQuestion(adminPage, "Retest advance Q3", ["A", "B", "C", "D"]);

    await adminPage.goto("/admin/rounds");
    const row = adminPage.getByRole("row", { name: new RegExp(round.title) });
    await row.getByRole("button", { name: "Open now" }).click();
    await expect(row.getByRole("cell").nth(3)).toContainText(/open/i);

    await loginAsTeam(page, TEAM);
    await page.goto(`/app/quiz/${roundId}`);
    await page.getByRole("button", { name: "I'm ready — start" }).click();

    // The reported bug: the question just sat there after its timer hit
    // zero. Touch nothing and assert it moves on by itself, twice.
    await expect(page.getByText("Question 1 of 3")).toBeVisible();
    await expect(page.getByText("Question 2 of 3")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Question 3 of 3")).toBeVisible({ timeout: 15_000 });

    await adminContext.close();
  });

  test("Finish & submit ends the attempt early with a confirmation and a receipt", async ({
    page,
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);

    const round = uniqueRound("finish");
    const roundId = await createRetestRound(adminPage, round);
    await adminPage.goto(`/admin/rounds/${roundId}`);
    await adminPage.getByRole("tab", { name: "Round policy" }).click();
    await adminPage.getByLabel("Exit policy").selectOption("lenient");
    await adminPage.getByRole("button", { name: "Save round policy" }).click();
    await expect(adminPage.getByText("Saved.", { exact: true })).toBeVisible();

    await adminPage.getByRole("tab", { name: "Quiz bank" }).click();
    await adminPage.getByPlaceholder("Option 1").fill("A");
    await adminPage.getByPlaceholder("Option 2").fill("B");
    await adminPage.getByPlaceholder("Option 3").fill("C");
    await adminPage.getByPlaceholder("Option 4").fill("D");
    await adminPage.getByLabel("Prompt").fill("Retest finish-button question");
    await adminPage.getByLabel("Timer (seconds)").fill("600");
    await adminPage.getByRole("button", { name: "Add question" }).click();
    await expect(adminPage.getByText(/^#0 /)).toBeVisible();

    await adminPage.goto("/admin/rounds");
    const row = adminPage.getByRole("row", { name: new RegExp(round.title) });
    await row.getByRole("button", { name: "Open now" }).click();
    await expect(row.getByRole("cell").nth(3)).toContainText(/open/i);

    await loginAsTeam(page, TEAM);
    await page.goto(`/app/quiz/${roundId}`);
    await page.getByRole("button", { name: "I'm ready — start" }).click();
    await expect(page.getByText(/Question 1 of/)).toBeVisible();

    // Backing out of the confirmation must leave the attempt running.
    await page.getByRole("button", { name: "Finish & submit" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Finish and submit?");
    await page.getByRole("button", { name: "Keep going" }).click();
    await expect(page.getByText(/Question 1 of/)).toBeVisible();

    await page.getByRole("button", { name: "Finish & submit" }).click();
    await page.getByRole("button", { name: "Yes, submit now" }).click();
    await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("You submitted your attempt.")).toBeVisible();
    await expect(page.getByText("Submitted at")).toBeVisible();

    await adminContext.close();
  });
});
