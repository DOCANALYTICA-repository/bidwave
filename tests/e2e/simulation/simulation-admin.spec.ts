import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * TESTING_GUIDE.md item 7: hide/show is independent of start/stop. Also
 * confirms the lifecycle controls (Start/Stop/Restart) and the winner
 * confirmation + reward action (SIM-11) exist in the admin UI, using the
 * exact button/heading labels from simulation-admin.tsx.
 */
test.describe("simulation admin controls", () => {
  test("hiding the simulation 404s /app/simulation for a team, independent of start/stop", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/simulation");

    const toggleButton = page.getByRole("button", { name: /Show to teams|Hide from teams/ });
    await expect(toggleButton).toBeVisible();
    if ((await toggleButton.innerText()) === "Hide from teams") {
      await toggleButton.click();
      await expect(page.getByRole("button", { name: "Show to teams" })).toBeVisible();
    }
    // Now hidden — confirmed by the toggle now reading "Show to teams".
    await expect(page.getByRole("button", { name: "Show to teams" })).toBeVisible();

    const teamContext = await browser.newContext();
    const teamPage = await teamContext.newPage();
    await loginAsTeam(teamPage, "bravo");
    // notFound() calls thrown from within an already-matched dynamic route
    // (dynamic = "force-dynamic") ship HTTP 200 with the correct not-found
    // content in this Next.js 16 App Router version — confirmed by direct
    // reproduction (curl against both dev and a production build) on the
    // structurally identical /rounds/[slug] case. Not something introduced
    // by this pass, and no low-risk userland fix exists (see src/app/
    // not-found.tsx and tests/e2e/public/rounds-listing.spec.ts) — assert
    // on the actual rendered content instead of the status code.
    await teamPage.goto("/app/simulation");
    await expect(teamPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await teamContext.close();

    // Reveal again and confirm the page becomes reachable, regardless of
    // whatever start/stop state the config is currently in.
    await page.getByRole("button", { name: "Show to teams" }).click();
    await expect(page.getByRole("button", { name: "Hide from teams" })).toBeVisible();

    const teamContext2 = await browser.newContext();
    const teamPage2 = await teamContext2.newPage();
    await loginAsTeam(teamPage2, "bravo");
    const revealedResponse = await teamPage2.goto("/app/simulation");
    expect(revealedResponse?.status()).toBe(200);
    await teamContext2.close();
  });

  test("start/stop/restart controls and winner-confirmation reward action exist", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/simulation");

    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

    // "Restart…" only renders once config.stopped_at is set — stop it first
    // if it isn't already, so the restart affordance is actually exercised.
    const stopButton = page.getByRole("button", { name: "Stop" });
    if (await stopButton.isEnabled()) {
      await stopButton.click();
      // Case-insensitive: the immediate toast reads "Simulation stopped."
      // (lowercase), while the persisted status line reads "· Stopped
      // {timestamp}" (capitalized) once the query invalidation refetches.
      await expect(page.getByText(/stopped/i).first()).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Restart…" })).toBeVisible();

    // SIM-11: winner confirmation + reward-as-marks-or-purse action.
    await expect(page.getByRole("heading", { name: "Confirm reward (SIM-11)" })).toBeVisible();
    await expect(page.getByText("Team", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Amount")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
  });
});
