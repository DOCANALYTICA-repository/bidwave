import { test, expect } from "@playwright/test";

/**
 * SiteHeader/SiteFooter (src/components/marketing/site-header.tsx,
 * site-footer.tsx) — persistent chrome across every (public) route.
 * Logged-out state shows Login + Register; the header also renders a
 * mobile Sheet menu with the same links, hidden at desktop widths.
 */
test.describe("site header — logged out", () => {
  test("desktop nav shows all seven public links plus Login/Register", async ({ page }) => {
    await page.goto("/");

    const header = page.locator("header");
    const expectedLinks: [string, string][] = [
      ["Home", "/"],
      ["Rounds", "/rounds"],
      ["Schedule", "/schedule"],
      ["Prizes", "/prizes"],
      ["Leaderboard", "/leaderboard"],
      ["Live", "/live"],
      ["FAQs", "/faqs"],
    ];
    for (const [label, href] of expectedLinks) {
      await expect(header.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
    }

    const loginLink = header.getByRole("link", { name: "Login", exact: true });
    const registerLink = header.getByRole("link", { name: "Register", exact: true });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute("href", "/login");
    await expect(registerLink).toBeVisible();
    await expect(registerLink).toHaveAttribute("href", "/register");

    // Logged out -> no "Dashboard" link.
    await expect(header.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  });

  test("mobile menu sheet also shows Login/Register", async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto("/");

    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Menu" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Login", exact: true })).toHaveAttribute("href", "/login");
    await expect(sheet.getByRole("link", { name: "Register", exact: true })).toHaveAttribute("href", "/register");
  });
});

test.describe("site footer", () => {
  test("footer 'Admin' link points at /login when logged out", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/login");
  });
});
