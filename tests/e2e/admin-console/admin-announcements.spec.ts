import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * src/app/admin/announcements/actions.ts exposes exactly two mutations:
 * adminUpsertAnnouncement (the "New announcement" form, submitted via
 * either the "Save as draft" or "Publish now" button, both wired to the
 * same action with a different `visibility` value) and
 * adminSetAnnouncementVisibility (the per-row toggle button, labelled
 * "Publish"/"Unpublish" depending on current state) — there is no delete
 * action, so this doesn't invent one.
 */
test("admin publishes an announcement, sees a toast, and it appears in the list; then unpublishes it", async ({ page }) => {
  const message = `E2E announcement ${Date.now()}`;

  await loginAsAdmin(page);
  await page.goto("/admin/announcements");
  await expect(page.getByRole("heading", { name: "Announcements" })).toBeVisible();

  await page.getByPlaceholder("Round 3 has been rescheduled to 3:30pm.").fill(message);
  await page.getByRole("button", { name: "Publish now" }).click();

  await expect(page.getByText("Announcement saved.")).toBeVisible();

  const row = page.locator("li", { hasText: message });
  await expect(row).toBeVisible();
  await expect(row.getByText("published", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByText("Announcement unpublished.")).toBeVisible();
  await expect(row.getByText("draft", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Publish" })).toBeVisible();
});
