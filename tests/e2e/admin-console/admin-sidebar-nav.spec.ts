import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * src/app/admin/admin-nav-link.tsx marks a link "active" when
 * `pathname === href || pathname.startsWith(`${href}/`)` and applies
 * "border-border bg-surface-3 text-foreground shadow-sm" instead of the
 * inactive "text-ink-2 hover:..." classes — asserting on computed
 * background-color (rather than the class string) actually exercises
 * whether bg-surface-3 resolves to a real, distinct color at runtime.
 */
test.describe("admin sidebar active-link highlighting", () => {
  test("the current route's link has a different background than an inactive link", async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto("/admin/rounds");
    const roundsLink = page.getByRole("link", { name: "Rounds", exact: true });
    const teamsLink = page.getByRole("link", { name: "Teams" });
    const roundsActiveBg = await roundsLink.evaluate((el) => getComputedStyle(el).backgroundColor);
    const teamsInactiveBg = await teamsLink.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(roundsActiveBg).not.toBe(teamsInactiveBg);

    await page.goto("/admin/teams");
    const teamsActiveBg = await teamsLink.evaluate((el) => getComputedStyle(el).backgroundColor);
    const roundsInactiveBg = await roundsLink.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(teamsActiveBg).not.toBe(roundsInactiveBg);
    // And the highlight actually followed the route, not stuck on Rounds.
    expect(teamsActiveBg).toBe(roundsActiveBg);
    expect(roundsInactiveBg).toBe(teamsInactiveBg);
  });

  test("a nested round-detail route still highlights the parent 'Rounds' link", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/rounds");
    const href = await page.getByRole("link", { name: "The Stat Sprint" }).getAttribute("href");
    await page.goto(href!);
    await expect(page).toHaveURL(/\/admin\/rounds\/.+/);

    const roundsLink = page.getByRole("link", { name: "Rounds", exact: true });
    const teamsLink = page.getByRole("link", { name: "Teams" });
    const roundsBg = await roundsLink.evaluate((el) => getComputedStyle(el).backgroundColor);
    const teamsBg = await teamsLink.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(roundsBg).not.toBe(teamsBg);
  });
});
