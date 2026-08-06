import { test, expect } from "@playwright/test";
import { ROUND_COPY_LIST } from "@/lib/rounds-catalog";

/**
 * Public landing page (src/app/(public)/page.tsx). Composed of Hero,
 * AboutSection, GuidelinesSection, RoundsTeaser (a 3-card preview — the
 * "all six rounds" list lives at /rounds, not here) and
 * RegistrationCtaSection, all wrapped by SiteHeader/SiteFooter from the
 * (public) layout.
 */
test.describe("landing page", () => {
  test("hero shows the brand line, dates, and a register CTA", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "The Pulse of IPL Auction" })).toBeVisible();
    await expect(page.getByText("17–19 August 2026 · Department of Commerce, CHRIST University")).toBeVisible();

    // Logged out -> dashboardHref is undefined -> CTA reads "Register your team" and links to /register.
    const registerCta = page.getByRole("link", { name: "Register your team" });
    await expect(registerCta).toBeVisible();
    await expect(registerCta).toHaveAttribute("href", "/register");
  });

  test("RoundsTeaser previews the first three rounds and links to the full list", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Six Rounds. One Champion." })).toBeVisible();

    // RoundsTeaser renders ROUND_COPY_LIST.slice(0, 3) — not all six — the
    // full six-round list lives on /rounds via "View all rounds".
    const preview = ROUND_COPY_LIST.slice(0, 3);
    for (const round of preview) {
      await expect(page.getByRole("heading", { name: round.name })).toBeVisible();
    }
    const excluded = ROUND_COPY_LIST.slice(3);
    for (const round of excluded) {
      await expect(page.getByRole("heading", { name: round.name })).toHaveCount(0);
    }

    const viewAll = page.getByRole("link", { name: "View all rounds" });
    const href = await viewAll.getAttribute("href");
    expect(href).toBe("/rounds");
  });

  test("registration CTA section renders an open/closed message and team login link", async ({ page }) => {
    await page.goto("/");

    // Exact copy depends on live registration_opens_at/closes_at state, so
    // assert on the section container rather than a single hardcoded string.
    await expect(
      page.getByRole("heading", { name: /Registration is (open|closed)|You're registered/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Team login" })).toHaveAttribute("href", "/login");
  });

  test("footer shows the three institutional logos, DOC Analytica credit, and brochure download", async ({ page }) => {
    await page.goto("/");

    const footer = page.locator("footer");
    await expect(footer.getByAltText("Bidwave — The Pulse of IPL Auction")).toBeVisible();
    await expect(footer.getByAltText("CHRIST (Deemed to be University)")).toBeVisible();
    await expect(footer.getByAltText("Department of Commerce")).toBeVisible();

    // PoweredByCredit — the mandatory "Powered by" + DOC Analytica mark line.
    await expect(footer.getByText("Powered by")).toBeVisible();
    await expect(footer.getByAltText("DOC Analytica")).toBeVisible();

    await expect(footer.getByText(/© 2026 Department of Commerce, CHRIST University\. Bidwave\./)).toBeVisible();

    const brochureLink = footer.getByRole("link", { name: "Download brochure" });
    await expect(brochureLink).toHaveAttribute("href", "/bidwave-brochure.pdf");
    await expect(brochureLink).toHaveAttribute("download", "BIDWAVE-2026-Brochure.pdf");
  });
});
