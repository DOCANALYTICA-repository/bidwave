import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * Regression coverage for "several pages crash on the browser's native back
 * button." Root cause was a Supabase realtime channel-reuse race in
 * src/lib/realtime/use-live-broadcast.ts (a fast unmount+remount could leave
 * a same-name channel registered, and supabase-js's `.channel()` returns
 * that already-subscribed channel instead of a fresh one, throwing on the
 * next `.on()` call) — reproduced live via rapid back/forward across
 * /admin/teams, /admin/rounds, /admin/auction/console. Also covers the quiz
 * runner's new `popstate` exit-detection listener (src/app/app/quiz/
 * [roundId]/quiz-runner.tsx).
 */
// Next.js dev mode's own performance-marker instrumentation can throw this
// benign, app-independent error under rapid navigation timing (confirmed via
// manual reproduction — it fires with or without the real bug present, and
// carries no digest/error-boundary trace). Filtered out so this test targets
// actual app crashes, not a dev-server-only timing artifact.
const BENIGN_DEV_NOISE = /cannot have a negative time stamp/;

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    if (!BENIGN_DEV_NOISE.test(err.message)) errors.push(err.message);
  });
  return errors;
}

test.describe("back-button crash regression", () => {
  test("admin: rapid back/forward across teams/rounds/auction-console does not crash", async ({ page }) => {
    const errors = collectPageErrors(page);
    await loginAsAdmin(page);

    await page.goto("/admin/teams");
    await expect(page.getByRole("heading", { name: "Teams" }).first()).toBeVisible();
    await page.goto("/admin/rounds");
    await expect(page.getByRole("heading", { name: "Rounds" }).first()).toBeVisible();
    await page.goto("/admin/auction/console");

    for (let i = 0; i < 4; i++) {
      await page.goBack();
      await page.waitForLoadState("networkidle");
    }
    for (let i = 0; i < 2; i++) {
      await page.goForward();
      await page.waitForLoadState("networkidle");
    }
    await page.goBack();
    await page.waitForLoadState("networkidle");

    // The page must still show real content, not a blank/dead tree.
    await expect(page.locator("body")).not.toBeEmpty();
    expect(errors, `Uncaught page errors during back/forward: ${errors.join("; ")}`).toEqual([]);
  });

  test("admin rounds workspace: native back does not crash", async ({ page }) => {
    const errors = collectPageErrors(page);
    await loginAsAdmin(page);
    await page.goto("/admin/rounds");
    const href = await page.getByRole("link", { name: "The Stat Sprint" }).getAttribute("href");
    await page.goto(href!);
    await expect(page.getByRole("heading", { name: "The Stat Sprint" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Rounds" }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("quiz mid-attempt: native back auto-submits instead of crashing", async ({ page, browser }) => {
    const errors = collectPageErrors(page);

    // Ensure round 1 is open and has at least one active question — admin
    // setup, mirrors the manual QA steps in TESTING_GUIDE.md. Uses a fully
    // separate browser context (not context.newPage()) so the admin session
    // cookie never leaks into the team session under test below.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto("/admin/rounds");
    const statSprintRow = adminPage.getByRole("row", { name: /The Stat Sprint/ });
    // open_now is idempotent server-side (unconditional `opened_early_at =
    // now()` unless already closed) — always click it rather than trying to
    // read the current status pill first, which avoids a flaky pre-check.
    await statSprintRow.getByRole("button", { name: "Open now" }).click();
    // Columns are Round / Kind / # / Status / Actions — target the Status
    // cell specifically rather than matching "open" text anywhere in the
    // row, which would also match the "Open now" action button's own label.
    await expect(statSprintRow.getByRole("cell").nth(3)).toContainText(/open/i);

    await adminPage.getByRole("link", { name: "The Stat Sprint" }).click();
    await adminPage.waitForURL(/\/admin\/rounds\/.+/);
    const roundId = adminPage.url().split("/admin/rounds/")[1];
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

    await loginAsTeam(page, "bravo");
    await page.goto(`/app/rounds/${roundId}`);
    await page.getByRole("link", { name: "Go to quiz" }).click();
    await page.getByRole("button", { name: "I'm ready — start" }).click();
    await expect(page.getByText(/Question 1 of/)).toBeVisible();

    // The critical regression case: native back mid-attempt.
    await page.goBack();
    await page.waitForLoadState("networkidle");
    expect(errors, `Uncaught page errors during quiz back-navigation: ${errors.join("; ")}`).toEqual([]);

    // The exit-detection navigate/popstate listener fires `finalize()`
    // fire-and-forget (see quiz-runner.tsx) — the server-side
    // submit_quiz_attempt round-trip isn't guaranteed done by the time
    // goBack() itself resolves, so poll. A direct page.goto (not a Link
    // click) forces a real navigation rather than risking a stale
    // Client Router Cache entry from the visit a few seconds ago.
    await expect(async () => {
      await page.goto(`/app/rounds/${roundId}`, { waitUntil: "networkidle" });
      await expect(page.getByText("Your attempt has been submitted.")).toBeVisible();
    }).toPass({ timeout: 15_000 });
  });
});
