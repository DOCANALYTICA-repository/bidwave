import { test as setup, type Page } from "@playwright/test";
import { ADMIN_EMAIL, DEMO_PASSWORD, TEAM_SLUGS, teamEmail, adminStoragePath, teamStoragePath } from "./fixtures";

/**
 * Runs once before the whole suite (see playwright.config.ts's "setup"
 * project) and saves one storageState per identity. Every other spec uses
 * `test.use({ storageState: adminStoragePath })` (or teamStoragePath(slug))
 * to start already-authenticated, instead of submitting the real login form
 * per test.
 *
 * This isn't just a speed optimization: SEC-10 rate-limits `login` to
 * 20 attempts per 900s per IP, and every Playwright request in this suite
 * comes from the same IP. A form-login-per-test suite this size blew
 * through that budget almost immediately on the first full run, causing
 * most of the suite to fail on an unrelated rate-limit 429 rather than any
 * real app bug. Logging in once per identity here keeps the whole run's
 * real-login count in the teens, not the hundreds — comfortably under the
 * limit. Specs that test the login/registration *act* itself
 * (login.spec.ts, registration-*.spec.ts) still submit the real form, since
 * that's what they're verifying.
 */
async function loginAndSave(page: Page, email: string, outFile: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.context().storageState({ path: outFile });
}

setup("authenticate as admin", async ({ page }) => {
  await loginAndSave(page, ADMIN_EMAIL, adminStoragePath());
});

for (const slug of TEAM_SLUGS) {
  setup(`authenticate as team ${slug}`, async ({ page }) => {
    await loginAndSave(page, teamEmail(slug), teamStoragePath(slug));
  });
}
