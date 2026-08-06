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
    const hiddenResponse = await teamPage.goto("/app/simulation");
    expect(hiddenResponse?.status()).toBe(404);
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

    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

    // "Restart…" only renders once config.stopped_at is set — stop it first
    // if it isn't already, so the restart affordance is actually exercised.
    const stopButton = page.getByRole("button", { name: "Stop" });
    if (await stopButton.isEnabled()) {
      await stopButton.click();
      await expect(page.getByText(/Stopped/)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Restart…" })).toBeVisible();

    // SIM-11: winner confirmation + reward-as-marks-or-purse action.
    await expect(page.getByRole("heading", { name: "Confirm reward (SIM-11)" })).toBeVisible();
    await expect(page.getByText("Team", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Amount")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
  });
});
