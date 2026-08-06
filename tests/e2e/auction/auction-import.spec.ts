import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * AUC-02/05: CSV import via /api/admin/auction/import-players (a Route
 * Handler, not a Server Action — see that route's own comment). Valid rows
 * commit even when other rows in the same file are invalid (admin_import_
 * players()'s per-row begin/exception block is a deliberate exception to
 * "zero partial writes", which is scoped to sale-rule validation only).
 * Headers below match IMPORT_COLUMN_ALIASES in src/lib/validation/auction.ts.
 */
test.describe("auction player import", () => {
  test("imports a valid row and reports an error for an invalid row", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/auction/players");

    const validName = `E2E Import Player ${Date.now()}`;
    // Row 2 (valid): all required fields present.
    // Row 3 (invalid): fullName is required (min 1 char) — left blank.
    const csv = [
      "External Ref,Full Name,Role,Base Price,Pool,Nationality",
      `E2E-IMPORT-VALID-${Date.now()},${validName},Batter,700,A,India`,
      `E2E-IMPORT-INVALID-${Date.now()},,Bowler,700,B,India`,
    ].join("\n");

    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "e2e-import.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });

    await page.getByRole("button", { name: "Import" }).click();

    await expect(page.getByText("1 player(s) imported.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("1 row(s) had errors")).toBeVisible();

    // Row 3 (header is row 1, so the second data row is row_number 3) —
    // field "fullName" per playerImportRowSchema's required min(1).
    await expect(page.getByText(/Row 3 · fullName:/)).toBeVisible();

    // A downloadable error report is offered.
    await expect(page.getByRole("button", { name: "Download error report" })).toBeVisible();

    // The valid row actually landed in the players table — the import
    // form's own result state doesn't trigger a router.refresh(), so the
    // server-rendered table below only reflects it after a reload.
    await page.reload();
    await expect(page.getByRole("row", { name: new RegExp(validName) })).toBeVisible();
  });
});
