import { execSync } from "child_process";

/**
 * Resets the active event edition to a known, deterministic fixture before
 * the whole e2e run — same seed:demo/unseed:demo scripts the manual QA
 * passes use (see TESTING_GUIDE.md), so every spec can rely on the fixed
 * accounts/data in ./fixtures.ts instead of registering fresh state.
 */
export default function globalSetup() {
  execSync("npm run unseed:demo", { stdio: "inherit" });
  execSync("npm run seed:demo", { stdio: "inherit" });
}
