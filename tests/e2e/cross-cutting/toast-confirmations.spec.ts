import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * Sonner toast confirmations after representative admin actions. Sonner
 * (src/components/ui/sonner.tsx) renders each toast as a
 * `[data-sonner-toast]` element (see node_modules/sonner) — there's no
 * `role="status"` in this version, so specs target that data attribute
 * directly rather than guessing at an ARIA role sonner doesn't actually set.
 */
test.describe("toast confirmations", () => {
  test("publishing a new announcement shows a success toast", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/announcements");

    const message = `E2E toast check ${Date.now()}`;
    await page.getByPlaceholder("Round 3 has been rescheduled to 3:30pm.").fill(message);
    await page.getByRole("button", { name: "Publish now" }).click();

    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Announcement saved." }).first(),
    ).toBeVisible();

    // The new row now exists, published — toggling it exercises the second
    // toast-bearing action (adminSetAnnouncementVisibility).
    const row = page.locator("li", { hasText: message });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Unpublish" }).click();

    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Announcement unpublished." }).first(),
    ).toBeVisible();
  });

  test("an 'Open now' round lifecycle action shows a success toast", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/rounds");

    // open_now is idempotent server-side (unconditional opened_early_at =
    // now() unless already closed) — safe to click regardless of the
    // round's current status, same reasoning as the back-button regression
    // spec's admin setup step.
    await page.getByRole("button", { name: "Open now" }).first().click();

    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Open now — done." }),
    ).toBeVisible();
  });
});
