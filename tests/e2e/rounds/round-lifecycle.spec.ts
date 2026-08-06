import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * §8/§9 round lifecycle: admin opens/closes a submission round, the team
 * dashboard reflects that in real time (server-computed status, not a
 * client clock), and admin_set_round_lifecycle()'s round_already_closed
 * guard (supabase/migrations/20260802000000_admin_reversal_and_simulation_visibility.sql)
 * actually blocks a plain "Open now" on a closed round — the only sanctioned
 * way back is the separate, reason-required Reopen flow.
 *
 * Uses "Operation Fan Heist" (seq 2, submission, no stage-qualification
 * requirement) so the team-eligibility check doesn't depend on any prior
 * qualification decision.
 */
const ROUND_NAME = "Operation Fan Heist";

async function findRow(page: Page): Promise<Locator> {
  return page.getByRole("row", { name: new RegExp(ROUND_NAME) });
}

function statusCellOf(row: Locator) {
  // Columns are Round / Kind / # / Status / Actions.
  return row.getByRole("cell").nth(3);
}

/** open_now is a no-op unless the round is closed, so it's only safe to
 * click blindly when we already know the round isn't closed. When it is
 * closed, the sanctioned way back is the reason-required Reopen dialog. */
async function ensureOpen(page: Page, row: Locator) {
  const status = await statusCellOf(row).textContent();
  if (status && /closed/i.test(status)) {
    await row.getByRole("button", { name: "Reopen…" }).click();
    await page.getByLabel("Reason (required)").fill("e2e round-lifecycle spec: reopen for test");
    await page.getByRole("button", { name: "Confirm reopen" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Round reopened." }),
    ).toBeVisible();
  } else {
    await row.getByRole("button", { name: "Open now" }).click();
  }
  await expect(statusCellOf(row)).toContainText(/open/i);
}

test.describe("round lifecycle", () => {
  test("admin opens a round, team sees it open/eligible; admin closes it, team sees it closed", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/rounds");

    const row = await findRow(page);
    await ensureOpen(page, row);

    const href = await row.getByRole("link", { name: ROUND_NAME }).getAttribute("href");
    expect(href).toBeTruthy();
    const roundId = href!.split("/admin/rounds/")[1];

    const teamContext = await browser.newContext();
    const teamPage = await teamContext.newPage();
    await loginAsTeam(teamPage, "alpha");
    await teamPage.goto(`/app/rounds/${roundId}`);

    // StatusPill's DOM text is "Open" (case-preserved; CSS applies the
    // uppercase transform), matching StatusPill's DEFAULT_LABELS["open-eligible"].
    await expect(teamPage.getByText("Open", { exact: true })).toBeVisible();
    // canSubmit is true (no requires_qualification_from_stage set on this
    // round), so the submission form itself must be present, not just the
    // read-only "closed" message.
    await expect(teamPage.getByRole("button", { name: "Submit" })).toBeVisible();

    // Admin closes the round — team's view must reflect it without relying
    // on the team's own client clock.
    await row.getByRole("button", { name: "Close now" }).click();
    await expect(statusCellOf(row)).toContainText(/closed/i);

    await teamPage.goto(`/app/rounds/${roundId}`);
    await expect(
      teamPage.getByText("Submission is closed. Files can no longer be viewed or replaced."),
    ).toBeVisible();
    // No upload UI is rendered at all once closed (round-workspace page.tsx
    // renders the read-only message instead of <SubmissionForm>).
    await expect(teamPage.getByRole("button", { name: "Submit" })).toHaveCount(0);

    await teamContext.close();

    // Restore an open round for any other spec that reuses this fixture.
    await ensureOpen(page, row);
  });

  test("a closed round rejects a plain 'Open now' — reopening requires the reason-required Reopen flow", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/rounds");

    const row = await findRow(page);
    // close_now is idempotent (only updates rows where closed_at is null),
    // so it's always safe to call regardless of current status.
    await row.getByRole("button", { name: "Close now" }).click();
    await expect(statusCellOf(row)).toContainText(/closed/i);

    // admin_set_round_lifecycle()'s open_now branch raises
    // [round_already_closed] once closed_at is set — surfaced to the UI as
    // a toast, not a silent no-op.
    await row.getByRole("button", { name: "Open now" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "A closed round cannot be reopened." }),
    ).toBeVisible();
    await expect(statusCellOf(row)).toContainText(/closed/i);

    // Leave the round open again for any other spec relying on this fixture.
    await row.getByRole("button", { name: "Reopen…" }).click();
    await page.getByLabel("Reason (required)").fill("e2e round-lifecycle spec: restore open state");
    await page.getByRole("button", { name: "Confirm reopen" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Round reopened." }),
    ).toBeVisible();
    await expect(statusCellOf(row)).toContainText(/open/i);
  });
});
