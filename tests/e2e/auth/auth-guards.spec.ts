import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * Regression coverage for the 3 originally-reported bugs this pass fixed —
 * see the "register-to-login redirect" root cause in src/proxy.ts.
 */
test.describe("route guards", () => {
  test("unauthenticated /app redirects to /login", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated /admin redirects to /login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("authenticated team hitting /login redirects to /app", async ({ page }) => {
    await loginAsTeam(page);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/app/);
  });

  test("authenticated admin hitting /login redirects to /admin", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/admin/);
  });

  test("team hitting /admin bounces to /app (role mismatch)", async ({ page }) => {
    await loginAsTeam(page);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/app/);
  });

  test("BUG FIX: authenticated team hitting /register redirects to /app, not a blank wizard", async ({ page }) => {
    await loginAsTeam(page);
    await page.goto("/register");
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByText("Register your team")).toHaveCount(0);
  });

  test("BUG FIX: authenticated admin hitting /register redirects to /admin", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/register");
    await expect(page).toHaveURL(/\/admin/);
  });

  test("/register/success stays reachable without a session", async ({ page }) => {
    await page.goto("/register/success?team=Franchise%20Alpha");
    await expect(page).toHaveURL(/\/register\/success/);
  });

  test("register and login pages cross-link to each other", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("link", { name: /Already registered\?/ })).toBeVisible();
    await page.goto("/login");
    await expect(page.getByRole("link", { name: /New team\?/ })).toBeVisible();
  });
});

test.describe("BUG FIX: admin tile buttons", () => {
  test("admin rounds page action buttons have a non-transparent background at rest", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/rounds");
    const editButton = page.getByRole("button", { name: "Edit" }).first();
    await expect(editButton).toBeVisible();
    const bg = await editButton.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");
  });
});
