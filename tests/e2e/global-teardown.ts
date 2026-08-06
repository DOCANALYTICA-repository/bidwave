import { execSync } from "child_process";

/** Leaves the hosted dev project clean after the run, same as every manual QA pass does. */
export default function globalTeardown() {
  execSync("npm run unseed:demo", { stdio: "inherit" });
}
