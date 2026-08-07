import { execSync } from "child_process";

/**
 * Leaves the dedicated `e2e-test` edition clean after the run — scoped the
 * same way global-setup.ts is, never the live edition.
 */
export default function globalTeardown() {
  execSync("npm run unseed:demo", {
    stdio: "inherit",
    env: { ...process.env, BIDWAVE_EVENT_EDITION_SLUG: "e2e-test" },
  });
}
