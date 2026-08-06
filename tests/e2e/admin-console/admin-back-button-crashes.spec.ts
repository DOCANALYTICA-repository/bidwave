import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin } from "../fixtures";

/**
 * Additional back-button coverage beyond
 * tests/e2e/regression/back-button-crash-regression.spec.ts, which already
 * covers rapid back/forward across /admin/teams, /admin/rounds and
 * /admin/auction/console, plus a mid-quiz-attempt native back. This file
 * targets two cases that spec doesn't: navigating back *while a detail
 * sheet is open* (the sheet is plain React state, not a route — opening it
 * pushes no history entry, so "back" from there falls straight through to
 * whatever page came before /admin/teams), and a native back mid-way
 * through the *registration wizard* for an unauthenticated visitor (same
 * reasoning: advancing a wizard step is local state, not routing).
 *
 * Both src/app/error.tsx and src/app/(public)/error.tsx render the same
 * "Something went wrong" heading on an uncaught render error — its absence
 * after the back-navigation is the actual "did this crash" signal used
 * below, on top of the pageerror listener used by the sibling regression
 * spec.
 */
const BENIGN_DEV_NOISE = /cannot have a negative time stamp/;

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    if (!BENIGN_DEV_NOISE.test(err.message)) errors.push(err.message);
  });
  return errors;
}

test.describe("additional back-button crash coverage", () => {
  test("admin: native back while a team detail sheet is open does not crash", async ({ page }) => {
    const errors = collectPageErrors(page);
    await loginAsAdmin(page);

    // Establish a real prior history entry before /admin/teams.
    await page.goto("/admin/rounds");
    await expect(page.getByRole("heading", { name: "Rounds" }).first()).toBeVisible();

    await page.goto("/admin/teams");
    await expect(page.getByRole("heading", { name: "Teams" }).first()).toBeVisible();

    // Open the sheet — this is local React state, not a route push.
    await page.getByRole("button", { name: "Franchise Alpha" }).click();
    await expect(page.getByRole("heading", { name: "Franchise Alpha" })).toBeVisible();

    await page.goBack();
    await page.waitForLoadState("networkidle");

    // Falls through to the real previous history entry (/admin/rounds),
    // not a blank tree or an error boundary.
    await expect(page).toHaveURL(/\/admin\/rounds/);
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Rounds" }).first()).toBeVisible();
    expect(errors, `Uncaught page errors: ${errors.join("; ")}`).toEqual([]);
  });

  test("registration wizard: native back mid-step (unauthenticated visitor) does not crash", async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto("/");
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Register your team" })).toBeVisible();

    // Advance one step — client-side wizard state, no history entry pushed.
    await page.getByLabel("Team name").fill(`Back Button Test ${Date.now()}`);
    await page.getByLabel("Campus").click();
    await page.getByRole("option", { name: "Bangalore" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Team members")).toBeVisible();

    await page.goBack();
    await page.waitForLoadState("networkidle");

    // Falls through to the real previous document ("/"), not a crash.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
    await expect(page.locator("body")).not.toBeEmpty();
    expect(errors, `Uncaught page errors: ${errors.join("; ")}`).toEqual([]);
  });
});
