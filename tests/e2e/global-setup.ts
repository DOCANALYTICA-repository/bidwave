import { execSync } from "child_process";

/**
 * Resets a dedicated, non-active `e2e-test` event edition to a known,
 * deterministic fixture before the whole e2e run — same seed:demo/
 * unseed:demo scripts the manual QA passes use (see TESTING_GUIDE.md), but
 * scoped away from the live edition via BIDWAVE_EVENT_EDITION_SLUG (see
 * scripts/resolve-edition.cjs and src/lib/event-edition.ts). Running these
 * against the live edition would disable purse_ledger_append_only and
 * rounds_no_reopen and delete every team/sale/ledger-entry/score/
 * submission for it — exactly what this isolation exists to prevent.
 */
const env = { ...process.env, BIDWAVE_EVENT_EDITION_SLUG: "e2e-test" };

export default function globalSetup() {
  execSync("npm run test:ensure-edition", { stdio: "inherit", env });
  execSync("npm run unseed:demo", { stdio: "inherit", env });
  execSync("npm run seed:demo", { stdio: "inherit", env });
}
