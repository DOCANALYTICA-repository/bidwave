import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * R6-05/§18: Round 6 ("The Owners' Summit", kind 'conference') scores are
 * seeded for every team (scripts/seed-demo.cjs, published: true) and must
 * be stored/aggregated as their own stage ('r6', migration
 * 20260801130000_seed_stages_and_simulation_config.sql) — distinct from the
 * final stage's aggregate, which deliberately has no stage_rounds at all
 * (R6-04: the final Top 10 is a manually curated
 * admin_publish_leaderboard() call, never a computed combination). This is
 * exactly what final-results/page.tsx's side-by-side "Final-stage
 * aggregate" vs. "Round 6 score" columns are for.
 */
test.describe("Round 6 scoring", () => {
  test("Round 6 (conference) scores display correctly on its own round workspace", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/rounds");

    const href = await page.getByRole("link", { name: "The Owners' Summit" }).getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(href!);
    await expect(page.getByRole("heading", { name: "The Owners' Summit" })).toBeVisible();

    // conference is neither 'quiz' nor 'auction', so Materials/Rubric/Scores
    // tabs all render (round-workspace.tsx) — Scores is what matters here.
    await page.getByRole("tab", { name: "Scores" }).click();

    const scoreTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Score" }) });
    await expect(scoreTable).toBeVisible();

    const firstScoreInput = scoreTable.locator("tbody tr").first().locator('input[type="number"]');
    await expect(firstScoreInput).toBeVisible();
    const value = await firstScoreInput.inputValue();
    expect(Number(value)).toBeGreaterThanOrEqual(60);
    expect(Number(value)).toBeLessThan(100);

    // Seeded scores are published: true — score-row.tsx toggles to
    // "Unpublish" once a score row is already published.
    await expect(scoreTable.locator("tbody tr").first().getByRole("button", { name: "Unpublish" })).toBeVisible();
  });

  test("Round 6's standing is aggregated separately from the final stage on Final Results", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/final-results");
    await expect(page.getByRole("heading", { name: "Final results" })).toBeVisible();

    await expect(page.getByRole("columnheader", { name: "Round 6 score" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Final-stage aggregate" })).toBeVisible();

    // At least one team has a real Round 6 standing (not the "—" placeholder
    // shown when a team has no row in that stage's standings). Columns are
    // Team / Final-stage aggregate / Round 6 score / Reference sum / ... —
    // target the 3rd cell specifically.
    const r6Cells = page.locator("table tbody tr td:nth-child(3)");
    const r6Texts = await r6Cells.allInnerTexts();
    expect(r6Texts.some((t) => /^#\d+ — \d/.test(t.trim()))).toBe(true);
  });
});
