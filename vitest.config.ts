import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Two kinds of tests live in this repo:
 *  - Business-rule / RPC tests that hit a real local Supabase Postgres
 *    (see docs — `npm run db:start` first). These need no DOM.
 *  - Component tests that need jsdom.
 * `environment: "jsdom"` covers both cheaply enough that we don't need a
 * per-file environment split yet; revisit if Postgres-hitting tests get
 * slow under jsdom's setup cost.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // Every file under tests/ opens its own pg.Client against the hosted
    // Supabase session pooler (see tests/helpers/db.ts) — running test
    // files in parallel (Vitest's default) can open enough simultaneous
    // connections to exceed the pooler's limit, which surfaces as
    // confusing 5s test timeouts rather than a connection error. Confirmed
    // by reproduction: the full suite times out under default parallelism
    // but passes 100% sequentially. Disabling file parallelism trades a
    // slower `vitest run` for a suite that doesn't flake as it grows.
    fileParallelism: false,
    // Vitest's own 5000ms default is tight for a test body doing several
    // sequential awaited round trips to a *hosted* (not local) Postgres
    // instance — observed real test bodies occasionally exceed it under
    // ordinary hosted-network latency variance, with no logic error
    // involved (isolated re-runs of the same test pass comfortably in
    // under 2s). Headroom here, not a fix for a slow query.
    testTimeout: 20000,
  },
});
