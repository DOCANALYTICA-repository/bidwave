import type { Page } from "@playwright/test";

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

export async function loginAsAdmin(page: Page) {
  await loginAs(page, ADMIN_EMAIL);
}

export async function loginAsTeam(page: Page, slug: (typeof TEAM_SLUGS)[number] = "alpha") {
  await loginAs(page, teamEmail(slug));
}
