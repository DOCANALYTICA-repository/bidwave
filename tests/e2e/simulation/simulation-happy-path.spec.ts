import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * SIM-01..11 happy path: admin independently reveals the simulation to teams
 * and starts its clock (two separate actions — see TESTING_GUIDE.md item 7
 * and simulation-admin.tsx's separate "Show to teams"/"Start" controls),
 * then a team submits an all-defaults attempt. scripts/seed-demo.cjs
 * calibrates the seeded config so every categorical default is options[0]
 * (never matched by any of the 4 answer keys, which only ever use
 * options[1..3]) and every slider default (50) sits far outside every key's
 * target±tolerance+falloff band — so an all-defaults submission is
 * guaranteed to land on exactly 70 overall, by construction, regardless of
 * which of the 4 keys is checked.
 */
test.describe("simulation happy path", () => {
  test("admin reveals + starts the simulation; team submits all-defaults for overall 70", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/simulation");

    // C2 (TESTING_GUIDE #7): "Show to teams"/"Hide from teams" is a single
    // toggle button whose label reflects current visibility — click only if
    // it currently says "Show to teams", since clicking "Hide from teams"
    // would undo the very state this test needs.
    const toggleButton = page.getByRole("button", { name: /Show to teams|Hide from teams/ });
    await expect(toggleButton).toBeVisible();
    if ((await toggleButton.innerText()) === "Show to teams") {
      await toggleButton.click();
      await expect(page.getByRole("button", { name: "Hide from teams" })).toBeVisible();
    }

    // Start is disabled once already started (config.started_at set) — only
    // click when it's still actionable, since Start has no "restart" affordance.
    const startButton = page.getByRole("button", { name: "Start", exact: true });
    await expect(startButton).toBeVisible();
    if (await startButton.isEnabled()) {
      await startButton.click();
      await expect(page.getByText(/Started/)).toBeVisible();
    }

    const teamContext = await browser.newContext();
    const teamPage = await teamContext.newPage();
    await loginAsTeam(teamPage, "alpha");

    const response = await teamPage.goto("/app/simulation");
    expect(response?.status()).toBe(200);

    // The 8 categorical parameter grids default to each param's first option
    // (already selected/highlighted) and the 4 sliders default to 50 — left
    // untouched here, this is the "all-defaults" probe.
    await expect(teamPage.getByRole("heading", { name: "On-spot simulation" })).toBeVisible();

    const analyzeButton = teamPage.getByRole("button", { name: "ANALYZE" });
    await expect(analyzeButton).toBeEnabled({ timeout: 15_000 });
    await analyzeButton.click();

    // simulation-console.tsx renders the result as a large mono/gold overall
    // score directly under the "STAR PLAYER"/"AWAITING FORMULA" heading —
    // there is no literal "Team Balance Score" label in the DOM, so this
    // asserts on the actual score value shown, calibrated to land on 70.
    await expect(teamPage.getByText(/AWAITING FORMULA|STAR PLAYER/)).toBeVisible({ timeout: 15_000 });
    await expect(teamPage.getByText("70", { exact: true })).toBeVisible();

    await teamContext.close();
  });
});
