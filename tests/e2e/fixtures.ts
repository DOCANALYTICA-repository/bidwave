import fs from "fs";
import path from "path";
import type { Cookie, Page } from "@playwright/test";

/** Matches scripts/seed-demo.cjs exactly — keep in sync if that script changes. */
export const DEMO_PASSWORD = "BidwaveDemo!1";
export const ADMIN_EMAIL = "admin@test.bidwave.local";

export const TEAM_SLUGS = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot",
  "golf", "hotel", "india", "juliett", "kilo", "lima",
] as const;

export function teamEmail(slug: (typeof TEAM_SLUGS)[number]) {
  return `captain-franchise-${slug}@test.bidwave.local`;
}

export function teamName(slug: (typeof TEAM_SLUGS)[number]) {
  const label = slug.charAt(0).toUpperCase() + slug.slice(1);
  return `Franchise ${label}`;
}

/** Logs in via the real /login form and waits for the post-login redirect. */
export async function loginAs(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * Saved-session paths, written once by auth.setup.ts (the "setup" project —
 * see playwright.config.ts), each holding one real login's cookies.
 */
export function adminStoragePath() {
  return path.join(__dirname, ".auth", "admin.json");
}

export function teamStoragePath(slug: (typeof TEAM_SLUGS)[number]) {
  return path.join(__dirname, ".auth", `team-${slug}.json`);
}

/**
 * Restores a saved session onto the given page's context by injecting its
 * cookies directly — no HTTP request, no form submission. `@supabase/ssr`'s
 * browser client keeps the session in cookies (not localStorage), which is
 * the whole point of that package existing (server-readable sessions for
 * SSR/middleware), so cookies alone are sufficient to restore it.
 *
 * loginAsAdmin/loginAsTeam use this instead of a real form submission
 * (which is what they did originally) specifically because SEC-10
 * rate-limits `login` to 20 attempts/900s per IP, and every Playwright
 * request in this suite shares one IP — a form-login-per-test suite this
 * size blew through that budget almost immediately on the first full run,
 * failing most of the suite on an unrelated 429 rather than any real app
 * bug. Every call site (`await loginAsAdmin(page)` / `await loginAsTeam(page,
 * slug)`) is unchanged; only what happens inside changed. Specs testing the
 * login/registration act itself (login.spec.ts, the registration specs)
 * still submit the real form directly, since that's what they verify.
 */
async function restoreSession(page: Page, storagePath: string) {
  const state = JSON.parse(fs.readFileSync(storagePath, "utf-8")) as { cookies: Cookie[] };
  await page.context().addCookies(state.cookies);
}

export async function loginAsAdmin(page: Page) {
  await restoreSession(page, adminStoragePath());
}

export async function loginAsTeam(page: Page, slug: (typeof TEAM_SLUGS)[number] = "alpha") {
  await restoreSession(page, teamStoragePath(slug));
}

/**
 * The console's player search — the only way to put a player up for bidding
 * since the workflow moved onto the console itself (the Players tab is now a
 * status record, with no "Set active" button).
 */
export const PLAYER_SEARCH_PLACEHOLDER = "Search unsold and available players…";

/**
 * Puts a player up for bidding from the console's own search and returns the
 * name picked. Safe to call unconditionally: activatePlayerForBidding closes
 * out whoever was already active, so this cannot trip
 * `players_one_active_per_edition`.
 *
 * Leaves the page on /admin/auction/console with the sale form open.
 */
export async function putPlayerUpForBidding(page: Page): Promise<string> {
  const { expect } = await import("@playwright/test");
  await page.goto("/admin/auction/console");
  const search = page.getByPlaceholder(PLAYER_SEARCH_PLACEHOLDER);
  await search.click();
  const firstOption = page.getByRole("option").first();
  await expect(firstOption).toBeVisible();
  // The option's first inner span is the name; the muted one under it is the pool.
  const name = (await firstOption.locator("span > span").first().innerText()).trim();
  await firstOption.click();
  // The sale form appears optimistically, ahead of the server confirming.
  await expect(page.getByRole("button", { name: "Record sale" })).toBeVisible();
  return name;
}
