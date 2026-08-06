import { test, expect } from "@playwright/test";

/**
 * `prefers-reduced-motion: reduce` — Playwright's built-in emulation (see
 * test.use below). Two components read useReducedMotion() from `motion`:
 *
 * - src/components/bidwave/page-transition.tsx: when reduced motion is on,
 *   it returns `<>{children}</>` directly, skipping the AnimatePresence /
 *   motion.div wrapper entirely (no fade transition between route changes).
 * - src/components/marketing/hero.tsx: the "Think Fast. Bid Smart. Build
 *   Champions." tagline drops its `animate-pulse` class and the
 *   motion.div wrappers' initial/animate props both collapse to `{}`.
 *
 * Neither leaves a dedicated DOM marker for "motion is off," so these specs
 * assert the concrete, source-verified behavior each component actually
 * changes under this media query, rather than inventing a fake selector.
 */
// This Playwright version has no top-level `reducedMotion` test fixture —
// it must go through `contextOptions` (verified against
// node_modules/playwright/types/test.d.ts).
test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("reduced motion", () => {
  test("hero tagline drops the animate-pulse class", async ({ page }) => {
    await page.goto("/");
    const tagline = page.getByText("Think Fast. Bid Smart. Build Champions.");
    await expect(tagline).toBeVisible();
    const hasPulseClass = await tagline.evaluate((el) => el.classList.contains("animate-pulse"));
    expect(hasPulseClass).toBe(false);
  });

  test("PageTransition renders children directly — navigating between public pages shows no stale duplicate content", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "The Pulse of IPL Auction" })).toBeVisible();

    const href = await page.locator("header").getByRole("link", { name: "Rounds", exact: true }).getAttribute("href");
    await page.goto(href!);
    await expect(page).toHaveURL(/\/rounds$/);

    // With PageTransition disabled (reduceMotion true), there's no
    // AnimatePresence exit animation keeping the previous route's tree
    // mounted alongside the new one — so exactly one instance of each
    // heading should exist, immediately, with no lingering duplicate.
    await expect(page.getByRole("heading", { name: "Six Rounds. One Champion." })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "The Pulse of IPL Auction" })).toHaveCount(0);
  });

  test("page still renders correctly under this emulation (no broken layout/errors)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/rounds");
    await expect(page.getByRole("heading", { name: "Six Rounds. One Champion." })).toBeVisible();
    await expect(page.locator("body")).not.toBeEmpty();
    expect(errors).toEqual([]);
  });
});
