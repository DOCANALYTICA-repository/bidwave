import { test, expect } from "@playwright/test";
import { loginAsAdmin, teamName } from "../fixtures";

/**
 * §11 scoring: entering a rubric-criterion score above its max_value must
 * produce a real, visible validation error (score-row.tsx's client-side
 * check before the RPC is even called) rather than a silent no-op, and a
 * valid score within range must actually save.
 *
 * Uses "Crisis Room" (seq 4) — deliberately a different round from
 * round-lifecycle/submission-flow's "Operation Fan Heist", so adding a
 * rubric criterion here can't put those specs' round into
 * criteria-scoring mode unexpectedly.
 */
const ROUND_NAME = "Crisis Room";
const CRITERION_LABEL = "E2E Presentation";
const CRITERION_MAX = 10;
const TEAM = "hotel" as const;

test.describe("scoring", () => {
  test("a criterion score over its max is rejected with a real error; a valid score saves", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/rounds");
    await page.getByRole("link", { name: ROUND_NAME }).click();
    await page.waitForURL(/\/admin\/rounds\/.+/);

    await page.getByRole("tab", { name: "Rubric" }).click();
    const criterionText = new RegExp(`${CRITERION_LABEL} · max ${CRITERION_MAX}`);
    if ((await page.getByText(criterionText).count()) === 0) {
      await page.getByLabel("Criterion").fill(CRITERION_LABEL);
      await page.getByLabel("Max value").fill(String(CRITERION_MAX));
      await page.getByRole("button", { name: "Add criterion" }).click();
      await expect(page.getByText(criterionText)).toBeVisible();
    }

    await page.getByRole("tab", { name: "Scores" }).click();
    const scoreRow = page.getByRole("row", { name: new RegExp(teamName(TEAM)) });
    await expect(scoreRow).toBeVisible();
    const scoreInput = scoreRow.locator('input[type="number"]').first();

    // Over the criterion's max — score-row.tsx's own pre-submit check
    // rejects this before the RPC is ever called; assert on that exact
    // message, not just "nothing happened".
    await scoreInput.fill(String(CRITERION_MAX + 10));
    await scoreRow.getByRole("button", { name: "Save" }).click();
    await expect(
      scoreRow.getByText(`${CRITERION_LABEL}: score can't exceed ${CRITERION_MAX}.`),
    ).toBeVisible();

    // A valid value within range saves fine.
    await scoreInput.fill("5");
    await scoreRow.getByRole("button", { name: "Save" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: `Score saved for ${teamName(TEAM)}.` }),
    ).toBeVisible();
    await expect(
      scoreRow.getByText(`${CRITERION_LABEL}: score can't exceed ${CRITERION_MAX}.`),
    ).toHaveCount(0);
  });
});
