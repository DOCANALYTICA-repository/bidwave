import { test, expect } from "@playwright/test";
import { loginAsAdmin, teamName } from "../fixtures";

/**
 * §12.2 stage qualification: the admin standings panel aggregates scores
 * per stage (stage_standings() — every team appears, even with a 0
 * aggregate, per its own "never silently excluded" contract), and a
 * qualification decision can actually be confirmed via
 * admin_confirm_qualifications().
 *
 * Uses the "Rounds 1 + 2" stage (code r1_r2), which the seed migration
 * (20260801130000_seed_stages_and_simulation_config.sql) already wires to
 * rounds 1 + 2 with weight 1 each, so standings are populated without this
 * spec needing to configure contributing rounds itself.
 */
const STAGE_LABEL = "Rounds 1 + 2";
const TEAM = "alpha" as const;

test.describe("stage qualification", () => {
  test("standings display and a qualification decision can be confirmed", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/stages");

    const panel = page
      .locator("div.rounded-xl")
      .filter({ has: page.getByRole("heading", { name: STAGE_LABEL, exact: true }) });
    await expect(panel).toBeVisible();

    // stage_standings() always returns one row per team once any round is
    // wired to the stage (teams cross joined against the contributing-round
    // set), so this must never show the "no scored rounds" empty state here.
    await expect(panel.getByText("No scored rounds contribute to this stage yet.")).toHaveCount(0);

    const row = panel.getByRole("row", { name: new RegExp(teamName(TEAM)) });
    await expect(row).toBeVisible();
    // Rank / Team / Aggregate / Decision — the aggregate cell must render a
    // real value, not be left blank.
    await expect(row.getByRole("cell").nth(2)).not.toBeEmpty();

    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: "Qualified" }).click();

    await panel.getByRole("button", { name: "Confirm qualifications" }).click();
    // adminConfirmQualifications() only renders a paragraph on error — its
    // absence after clicking is the success signal.
    await expect(panel.locator("p.text-unsold")).toHaveCount(0);
  });
});
