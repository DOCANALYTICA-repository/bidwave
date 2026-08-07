import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against the hosted dev Supabase project via .env.local (Docker is
 * broken on this machine, so there's no local stack to point at instead —
 * see CLAUDE.md). globalSetup/globalTeardown reset the event edition to a
 * deterministic fixture using the same seed:demo/unseed:demo scripts the
 * manual QA passes already use, so specs can log in with known accounts
 * instead of registering a fresh team every time (the registration specs
 * are the ones that deliberately walk the real UI instead).
 *
 * The "setup" project (tests/e2e/auth.setup.ts) logs in once per identity
 * and saves a storageState; the "chromium" project depends on it and most
 * specs reuse those saved sessions via `test.use({ storageState: ... })`
 * instead of submitting the real login form per test. This isn't just
 * speed — SEC-10 rate-limits login to 20/900s per IP, and a form-login-per-
 * test suite this size blew through that budget on the first full run,
 * failing most of the suite on an unrelated 429 rather than any real bug.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Must be false: a dev server the developer already had running
    // (without BIDWAVE_EVENT_EDITION_SLUG) would otherwise be reused as-is,
    // resolving the LIVE edition instead of the dedicated e2e-test one —
    // the specs would then quietly run destructive seed/unseed cycles
    // against production data. See src/lib/event-edition.ts.
    reuseExistingServer: false,
    timeout: 60_000,
    env: { BIDWAVE_EVENT_EDITION_SLUG: "e2e-test" },
  },
});
