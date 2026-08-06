import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

test.describe("admin activity log", () => {
  test("renders login activity rows (not live — SSR on each visit)", async ({ page }) => {
    // loginAsAdmin itself calls login(), which logs a real "login_success"
    // activity_events row (src/app/login/actions.ts) before this test even
    // visits the page — so a fresh seed still has at least one real row to
    // assert on, without needing another spec to have run first.
    await loginAsAdmin(page);
    await page.goto("/admin/activity");
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();

    await expect(page.getByText("login_success")).toBeVisible();
    await expect(page.getByText("admin").first()).toBeVisible();
  });

  test("Refresh re-fetches the (non-realtime) activity table", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/activity");
    await expect(page.getByText("Not live — use Refresh for the latest.")).toBeVisible();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("login_success")).toBeVisible();
  });
});

/**
 * REP-01..07: one GET route per kind (/api/admin/exports/[kind]), each
 * streaming a real file via Content-Disposition — the exact 8 kinds are
 * the EXPORT_KINDS list in src/app/api/admin/exports/[kind]/route.ts,
 * matching the labels rendered by src/app/admin/exports/page.tsx.
 */
const EXPORTS: { label: string; filenamePrefix: string }[] = [
  { label: "Teams", filenamePrefix: "bidwave-teams-" },
  { label: "Submissions", filenamePrefix: "bidwave-submissions-" },
  { label: "Submission files (bulk)", filenamePrefix: "bidwave-submission-files-" },
  { label: "Scores, aggregates & ranks", filenamePrefix: "bidwave-scores-" },
  { label: "Player import errors", filenamePrefix: "bidwave-import-errors-" },
  { label: "Sales, reversals, rosters & final squads", filenamePrefix: "bidwave-sales-" },
  { label: "Activity log", filenamePrefix: "bidwave-activity-" },
  { label: "Auction audit trail", filenamePrefix: "bidwave-auction-audit-" },
];

test.describe("admin exports", () => {
  for (const { label, filenamePrefix } of EXPORTS) {
    test(`"${label}" download link actually triggers a file download`, async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto("/admin/exports");

      const row = page.locator("li", { hasText: label });
      await expect(row).toBeVisible();

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        row.getByRole("link", { name: "Download" }).click(),
      ]);

      expect(download.suggestedFilename()).toContain(filenamePrefix);
    });
  }
});
