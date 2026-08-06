import { test, expect } from "@playwright/test";
import { DEMO_PASSWORD, teamEmail } from "../fixtures";

/**
 * src/app/login/actions.ts deliberately returns the same "Invalid email or
 * password." message whether the email doesn't exist or the password is
 * wrong (SEC-11-adjacent: don't reveal which one it was) — both cases
 * below assert that exact copy, not two different messages.
 */
test.describe("login", () => {
  test("wrong password shows the real error copy", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(teamEmail("alpha"));
    await page.getByLabel("Password").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("unknown email shows the same error copy (does not reveal account existence)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(`nobody-${Date.now()}@btech.christuniversity.in`);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("register and login pages cross-link to each other with correct hrefs", async ({ page }) => {
    await page.goto("/register");
    const registerToLogin = page.getByRole("link", { name: /Already registered\?/ });
    await expect(registerToLogin).toBeVisible();
    expect(await registerToLogin.getAttribute("href")).toBe("/login");

    await page.goto("/login");
    const loginToRegister = page.getByRole("link", { name: /New team\?/ });
    await expect(loginToRegister).toBeVisible();
    expect(await loginToRegister.getAttribute("href")).toBe("/register");
  });
});
