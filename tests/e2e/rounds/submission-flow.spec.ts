import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * §9.1/SUB-02/03/05: a team can upload to an open submission round, freely
 * replace the whole file set while it stays open (whole-set replacement,
 * not additive — src/app/app/rounds/[id]/actions.ts's submit_round_files),
 * and gets a real, working download link back (audit A6 — teams could
 * previously see a filename with no way to actually open it). Once the
 * round closes, the upload UI disappears entirely.
 *
 * Uses "Operation Fan Heist" (seq 2, submission, no stage-qualification
 * requirement), same fixture round-lifecycle.spec.ts uses — reopens it via
 * the admin Reopen flow if a previous spec left it closed, so this test
 * doesn't depend on run order.
 */
const ROUND_NAME = "Operation Fan Heist";
const FILE_DROP_LABEL = "Drop files here, or click to browse";

async function ensureOpen(adminPage: Page, row: Locator) {
  const statusCell = row.getByRole("cell").nth(3);
  const status = await statusCell.textContent();
  if (status && /closed/i.test(status)) {
    await row.getByRole("button", { name: "Reopen…" }).click();
    await adminPage.getByLabel("Reason (required)").fill("e2e submission-flow spec: reopen for test");
    await adminPage.getByRole("button", { name: "Confirm reopen" }).click();
    await expect(
      adminPage.locator("[data-sonner-toast]").filter({ hasText: "Round reopened." }),
    ).toBeVisible();
  } else {
    await row.getByRole("button", { name: "Open now" }).click();
  }
  await expect(statusCell).toContainText(/open/i);
}

test.describe("submission flow", () => {
  test("team uploads, replaces the file while open, then is blocked once closed", async ({
    page,
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto("/admin/rounds");
    const row = adminPage.getByRole("row", { name: new RegExp(ROUND_NAME) });
    await ensureOpen(adminPage, row);

    const href = await row.getByRole("link", { name: ROUND_NAME }).getAttribute("href");
    const roundId = href!.split("/admin/rounds/")[1];

    await loginAsTeam(page, "bravo");
    await page.goto(`/app/rounds/${roundId}`);
    await expect(page.getByText("Open", { exact: true })).toBeVisible();

    // First upload.
    await page.getByLabel(FILE_DROP_LABEL).setInputFiles({
      name: "proposal.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e submission-flow test file A"),
    });
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Submitted.")).toBeVisible();

    // Reload to see the server-rendered current-file section — a real
    // signed download link, not just a filename (audit A6).
    await page.reload();
    const firstLink = page.getByRole("link", { name: "proposal.pdf" });
    await expect(firstLink).toBeVisible();
    const firstHref = await firstLink.getAttribute("href");
    expect(firstHref).toBeTruthy();
    expect(firstHref).not.toBe("#");

    // Replace it with a different file while the round is still open —
    // this must supersede the prior file, not add to it.
    await page.getByLabel(FILE_DROP_LABEL).setInputFiles({
      name: "revised.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e submission-flow test file B"),
    });
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Submitted.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("link", { name: "revised.pdf" })).toBeVisible();
    await expect(page.getByRole("link", { name: "proposal.pdf" })).toHaveCount(0);

    // Admin closes the round — upload must now be blocked entirely.
    await row.getByRole("button", { name: "Close now" }).click();
    await expect(row.getByRole("cell").nth(3)).toContainText(/closed/i);

    await page.reload();
    await expect(
      page.getByText("Submission is closed. Files can no longer be viewed or replaced."),
    ).toBeVisible();
    await expect(page.getByLabel(FILE_DROP_LABEL)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit" })).toHaveCount(0);

    // Restore an open round for any other spec relying on this fixture.
    await ensureOpen(adminPage, row);
    await adminContext.close();
  });
});
