import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against the hosted dev Supabase project via .env.local (Docker is
 * broken on this machine, so there's no local stack to point at instead —
 * see CLAUDE.md). globalSetup/globalTeardown reset the event edition to a
 * deterministic fixture using the same seed:demo/unseed:demo scripts the
 * manual QA passes already use, so specs can log in with known accounts
 * instead of registering a fresh team every time (registration.spec.ts is
 * the one spec that deliberately walks the real UI instead).
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
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
