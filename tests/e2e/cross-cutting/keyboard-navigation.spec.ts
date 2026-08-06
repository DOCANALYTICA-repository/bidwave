import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * Keyboard (Tab-key) traversal reaching a real :focus-visible ring.
 *
 * Both src/components/marketing/site-header.tsx nav links and
 * src/app/admin/admin-nav-link.tsx share the same Tailwind pattern —
 * `focus-visible:ring-3 focus-visible:ring-ring/50` — applied only via the
 * browser's native :focus-visible pseudo-class (no custom focus-tracking
 * JS), which real keyboard-driven focus (as opposed to a mouse click)
 * reliably triggers in Chromium. Asserting `el.matches(':focus-visible')`
 * after tabbing there is the accurate way to confirm the ring would
 * actually paint, since Tailwind's own ring classes aren't otherwise
 * distinguishable via getComputedStyle without hardcoding pixel values.
 */
async function tabUntil(
  page: Page,
  predicate: (info: { tag: string; href: string | null }) => boolean,
  maxPresses = 60,
): Promise<{ tag: string; href: string | null; focusVisible: boolean }> {
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      return {
        tag: el.tagName,
        href: el instanceof HTMLAnchorElement ? el.getAttribute("href") : null,
        focusVisible: el.matches(":focus-visible"),
      };
    });
    if (info && predicate(info)) return info;
  }
  throw new Error("tabUntil: predicate never matched within maxPresses");
}

test.describe("keyboard navigation — public nav", () => {
  test("Tab traversal reaches a public nav link with a real focus-visible ring", async ({ page }) => {
    await page.goto("/");
    await page.locator("body").click({ position: { x: 5, y: 5 } }); // ensure focus starts outside any link
    await page.keyboard.press("Tab"); // re-arm from a known start point

    const result = await tabUntil(page, (info) => info.tag === "A" && info.href === "/rounds");
    expect(result.focusVisible).toBe(true);
  });
});

test.describe("keyboard navigation — admin sidebar", () => {
  test("Tab traversal reaches an admin sidebar link with a real focus-visible ring", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/teams");

    const result = await tabUntil(page, (info) => info.tag === "A" && info.href === "/admin/rounds");
    expect(result.focusVisible).toBe(true);
  });
});
