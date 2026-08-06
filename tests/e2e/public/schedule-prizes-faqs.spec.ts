import { test, expect } from "@playwright/test";
import { ROUND_COPY } from "@/lib/rounds-catalog";

/**
 * /schedule, /prizes, /faqs (src/app/(public)/schedule|prizes|faqs/page.tsx).
 * Schedule content is fully static (ScheduleSection hardcodes days/rounds);
 * prizes and faqs are settings-driven and render an EmptyState when the
 * admin hasn't configured them yet — both are legitimate, so assert
 * whichever is actually present rather than assuming content exists.
 */
test.describe("schedule", () => {
  test("renders the static day-by-day schedule linking to real rounds", async ({ page }) => {
    await page.goto("/schedule");

    await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
    await expect(page.getByText("17–19 August 2026 · CHRIST University")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Online" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Day 1" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Day 2" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Day 3" })).toBeVisible();

    const statSprintLink = page.getByRole("link", { name: ROUND_COPY["the-stat-sprint"].name });
    await expect(statSprintLink).toHaveAttribute("href", "/rounds/the-stat-sprint");
    const auctionLink = page.getByRole("link", { name: ROUND_COPY["the-grand-auction"].name });
    await expect(auctionLink).toHaveAttribute("href", "/rounds/the-grand-auction");
  });
});

test.describe("prizes", () => {
  test("renders either configured prizes or the 'to be announced' empty state", async ({ page }) => {
    await page.goto("/prizes");

    await expect(page.getByRole("heading", { name: "Prizes", exact: true })).toBeVisible();

    const emptyState = page.getByText("Prizes to be announced");
    const isEmpty = (await emptyState.count()) > 0;
    if (isEmpty) {
      await expect(emptyState).toBeVisible();
    } else {
      // PrizesSection renders one card per configured prize, each with an
      // uppercase "place" label (e.g. "1st place") and a detail line.
      await expect(page.locator("main")).not.toBeEmpty();
    }
  });
});

test.describe("faqs", () => {
  test("renders either configured FAQs (as an accordion) or the 'no FAQs yet' empty state", async ({ page }) => {
    await page.goto("/faqs");

    await expect(page.getByRole("heading", { name: "Frequently Asked Questions" })).toBeVisible();

    const emptyState = page.getByText("No FAQs yet");
    const isEmpty = (await emptyState.count()) > 0;
    if (isEmpty) {
      await expect(emptyState).toBeVisible();
      await expect(page.getByText("Check back soon.")).toBeVisible();
    } else {
      // FaqAccordion — at least one accordion trigger (the question text)
      // should be present and expandable.
      const firstTrigger = page.getByRole("button").first();
      await expect(firstTrigger).toBeVisible();
      await firstTrigger.click();
    }
  });
});
