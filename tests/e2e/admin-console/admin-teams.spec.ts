import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * src/app/admin/teams/teams-table.tsx: PAGE_SIZE = 25, client-side search
 * across name/campus/member fields, pagination controls only render when
 * `pageCount > 1`. The seeded fixture has 12 teams (scripts/seed-demo.cjs)
 * — well under one page — so this asserts the *correct* absence of
 * pagination controls at that count, rather than fabricating >25 teams to
 * exercise page-flipping that the current fixture can't produce.
 */
test.describe("admin teams directory", () => {
  test("search filters the list to matching teams only", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/teams");
    await expect(page.getByRole("heading", { name: "Teams" }).first()).toBeVisible();

    await expect(page.getByRole("button", { name: "Franchise Bravo" })).toBeVisible();

    await page.getByPlaceholder(/Search by team, campus, member name/).fill("Alpha");

    await expect(page.getByRole("button", { name: "Franchise Alpha" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Franchise Bravo" })).toHaveCount(0);
  });

  test("with only 12 seeded teams (page size 25), no pagination controls render", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/teams");
    await expect(page.getByRole("heading", { name: "Teams" }).first()).toBeVisible();

    await expect(page.getByRole("button", { name: "Previous" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
  });

  test("clicking a team opens its detail sheet with roster and invoice tab", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/teams");

    await page.getByRole("button", { name: "Franchise Alpha" }).click();

    // SheetTitle repeats the team name, and the Details tab shows the
    // seeded roster (scripts/seed-demo.cjs: "Franchise Alpha Member 1/2/3").
    // membersToInput() (teams-table.tsx) sorts the captain to the front, and
    // seed-demo.cjs always marks member index 0 ("...Member 1") captain.
    await expect(page.getByRole("heading", { name: "Franchise Alpha" })).toBeVisible();
    await expect(page.getByLabel("Full name").nth(0)).toHaveValue("Franchise Alpha Member 1");
    await expect(page.getByLabel("Full name").nth(1)).toHaveValue("Franchise Alpha Member 2");
    await expect(page.getByLabel("Full name").nth(2)).toHaveValue("Franchise Alpha Member 3");

    // Invoice tab — the seed script never creates an `invoices` row for any
    // team, so getInvoiceSignedUrl() (actions.ts) genuinely returns null
    // and the sheet must surface that as an error toast, not a silent
    // no-op or a fake success.
    await page.getByRole("tab", { name: "Invoice" }).click();
    await page.getByRole("button", { name: "Open invoice" }).click();
    await expect(page.getByText("Could not load the invoice.")).toBeVisible();
  });
});
