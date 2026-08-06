import { test, expect } from "@playwright/test";
import { ROUND_COPY_LIST } from "@/lib/rounds-catalog";

/**
 * /rounds and /rounds/[slug] (src/app/(public)/rounds/page.tsx and
 * rounds/[slug]/page.tsx).
 *
 * Gating is more nuanced than a blanket 404: the About/summary block on the
 * detail page is always the static brochure copy from rounds-catalog.ts —
 * that never depends on `public_released_at`. Only the "Materials" section
 * is gated: `rounds_with_status` is only visible to an anon query once
 * `public_released_at` is set (RLS), so an unreleased round still renders
 * its round page (200, full brochure copy) but shows the "Nothing to show
 * yet" EmptyState instead of a StatusPill + materials list. A 404 only
 * happens for a slug that isn't in the static ROUND_COPY catalog at all.
 */
test.describe("rounds listing", () => {
  test("/rounds lists all six rounds", async ({ page }) => {
    await page.goto("/rounds");

    await expect(page.getByRole("heading", { name: "Six Rounds. One Champion.", exact: true })).toBeVisible();
    for (const round of ROUND_COPY_LIST) {
      await expect(page.getByRole("heading", { name: round.name })).toBeVisible();
    }
  });

  test("/rounds/[slug] for a known round always renders the static brochure copy", async ({ page }) => {
    const round = ROUND_COPY_LIST[0];
    await page.goto(`/rounds/${round.slug}`);

    await expect(page.getByRole("heading", { name: round.name })).toBeVisible();
    await expect(page.getByText(round.tagline)).toBeVisible();
    await expect(page.getByText(round.summary)).toBeVisible();

    // Materials section: either gated (no released row yet) or released —
    // don't assume which state the hosted fixture is in, just assert the
    // gating is coherent (exactly one of these two states holds).
    const materialsHeading = page.getByRole("heading", { name: "Materials" });
    await expect(materialsHeading).toBeVisible();

    const emptyState = page.getByText("Nothing to show yet");
    const releasedPill = page.getByText("Released", { exact: true });
    const isGated = await emptyState.count();
    const isReleased = await releasedPill.count();
    expect(isGated > 0 || isReleased > 0).toBe(true);
    // Never both at once.
    expect(isGated > 0 && isReleased > 0).toBe(false);
  });

  test("/rounds/[slug] for an unknown slug 404s", async ({ page }) => {
    const response = await page.goto("/rounds/not-a-real-round-slug");
    expect(response?.status()).toBe(404);
  });
});
