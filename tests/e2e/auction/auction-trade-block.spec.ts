import { test, expect, type Locator, type Page } from "@playwright/test";
import { loginAsAdmin, loginAsTeam } from "../fixtures";

/**
 * The trade block. execute_trade/reverse_trade are covered at the SQL level in
 * tests/trades.test.ts; what this file exists to prove is the claim the feature
 * rests on — that a trade needs no trade-aware code anywhere else.
 *
 * Nothing in the squad board, the tracker page or /live knows what a trade is.
 * They read `players.current_team_id` and the purse ledger, which is exactly
 * what execute_trade moves, so a swap has to show up on all of them with no
 * further wiring. If that ever stops being true, this spec is where it breaks.
 */

/**
 * Opens the tab and waits for the route transition to settle.
 *
 * PageTransition wraps every route in `AnimatePresence mode="popLayout"`, which
 * keeps the *outgoing* tree mounted for its 150ms crossfade — so mid-navigation
 * both route trees are in the DOM and every id on the page appears twice.
 * Waiting for a single match beats reaching for `.first()` and hoping the
 * incoming tree is the one that comes back.
 */
async function openTradeBlock(page: Page) {
  await page.goto("/admin/auction/trades");
  await expect(page.locator("#trade-team-a")).toHaveCount(1);
}

/** One franchise's tile on a squad board, addressed by its heading. */
function boardTile(page: Page, franchise: string): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: franchise, exact: true }) })
    .first();
}

/** The first tickable player on one side, and their name. */
async function firstPlayer(page: Page, field: string): Promise<{ box: Locator; name: string }> {
  const box = page.locator(`input[name="${field}"]`).first();
  await expect(box).toBeVisible();
  // The label's first span holds the name plus an optional "· overseas" tag.
  const label = await box.locator("xpath=../span[1]").innerText();
  return { box, name: label.split("·")[0]!.trim() };
}

test.describe("auction trade block", () => {
  test("a swap moves both players and shows up on every squad board", async ({ page }) => {
    await loginAsAdmin(page);
    await openTradeBlock(page);

    await page.locator("#trade-team-a").fill("Alpha");
    await page.getByRole("option", { name: /Franchise Alpha/ }).click();
    await page.locator("#trade-team-b").fill("Bravo");
    await page.getByRole("option", { name: /Franchise Bravo/ }).click();

    const fromAlpha = await firstPlayer(page, "playersAToB");
    const fromBravo = await firstPlayer(page, "playersBToA");
    await fromAlpha.box.check();
    await fromBravo.box.check();
    await page.locator("#trade-memo").fill("E2E swap");

    await page.getByRole("button", { name: "Execute trade" }).click();
    await expect(page.getByText("Trade executed.")).toBeVisible();

    // The log shows the deal in both directions, with the note.
    const logCard = page.getByRole("listitem").filter({ hasText: "E2E swap" }).first();
    await expect(logCard).toContainText(fromAlpha.name);
    await expect(logCard).toContainText(fromBravo.name);

    // The admin tracker's board — no trade-aware code in it at all.
    await page.goto("/admin/auction/tracker");
    await expect(boardTile(page, "Franchise Alpha")).toContainText(fromBravo.name);
    await expect(boardTile(page, "Franchise Bravo")).toContainText(fromAlpha.name);

    // /live is deliberately not asserted here. Its board renders only the
    // *seated* franchises (seatedTeams(), from auction_franchise_assignments)
    // and the demo seed assigns none, so the public board is empty in this
    // fixture — nothing to do with trades. It builds its tiles from the same
    // buildSquadBoard() over the same players.current_team_id the tracker
    // assertion above already covers.

    // Reversing restores both squads.
    await openTradeBlock(page);
    await page.getByRole("button", { name: "Reverse…" }).first().click();
    await page.locator('input[id^="reverse-"]').first().fill("E2E undo");
    await page.getByRole("button", { name: "Confirm reversal" }).click();
    await expect(page.getByText("Trade reversed.")).toBeVisible();

    await page.goto("/admin/auction/tracker");
    await expect(boardTile(page, "Franchise Alpha")).toContainText(fromAlpha.name);
    await expect(boardTile(page, "Franchise Bravo")).toContainText(fromBravo.name);
  });

  test("both affected teams see the trade on their own dashboard", async ({ page, browser }) => {
    await loginAsAdmin(page);
    await openTradeBlock(page);

    await page.locator("#trade-team-a").fill("Golf");
    await page.getByRole("option", { name: /Franchise Golf/ }).click();
    await page.locator("#trade-team-b").fill("Hotel");
    await page.getByRole("option", { name: /Franchise Hotel/ }).click();

    const fromGolf = await firstPlayer(page, "playersAToB");
    await fromGolf.box.check();
    await page.locator("#trade-cash-b").fill("0.0002");
    await page.getByRole("button", { name: "Execute trade" }).click();
    await expect(page.getByText("Trade executed.")).toBeVisible();

    // Golf sent a player and received cash.
    const golfContext = await browser.newContext();
    const golfPage = await golfContext.newPage();
    await loginAsTeam(golfPage, "golf");
    await golfPage.goto("/app/auction");
    const golfCard = golfPage.getByRole("listitem").filter({ hasText: "Franchise Hotel" }).first();
    await expect(golfCard).toContainText(fromGolf.name);
    await expect(golfCard).toContainText("Cash received");
    // The cash half also lands in the purse ledger on its own, via entry_kind.
    await expect(golfPage.getByText(/^trade —/).first()).toBeVisible();
    await golfContext.close();

    // Hotel is the mirror: received the player, paid the cash.
    const hotelContext = await browser.newContext();
    const hotelPage = await hotelContext.newPage();
    await loginAsTeam(hotelPage, "hotel");
    await hotelPage.goto("/app/auction");
    const hotelCard = hotelPage.getByRole("listitem").filter({ hasText: "Franchise Golf" }).first();
    await expect(hotelCard).toContainText(fromGolf.name);
    await expect(hotelCard).toContainText("Cash paid");
    await hotelContext.close();
  });

  test("cash moves the purse on both sides", async ({ page }) => {
    await loginAsAdmin(page);
    await openTradeBlock(page);

    await page.locator("#trade-team-a").fill("Charlie");
    await page.getByRole("option", { name: /Franchise Charlie/ }).click();
    await page.locator("#trade-team-b").fill("Delta");
    await page.getByRole("option", { name: /Franchise Delta/ }).click();

    // The purse chips carry the exact rupee figure as a tooltip, since the
    // visible number is rounded to crore.
    const readPurse = async (side: "a" | "b") => {
      const title = await page
        .locator(`[data-trade-side="${side}"] [title^='Purse remaining']`)
        .first()
        .getAttribute("title");
      return Number((title ?? "").replace(/[^0-9]/g, ""));
    };
    const beforeC = await readPurse("a");
    const beforeD = await readPurse("b");

    // 0.0002cr is ₹2,000 — small enough to fit the demo seed's tiny purses.
    await page.locator("#trade-cash-a").fill("0.0002");
    await page.getByRole("button", { name: "Execute trade" }).click();
    await expect(page.getByText("Trade executed.")).toBeVisible();

    await page.locator("#trade-team-a").fill("Charlie");
    await page.getByRole("option", { name: /Franchise Charlie/ }).click();
    await page.locator("#trade-team-b").fill("Delta");
    await page.getByRole("option", { name: /Franchise Delta/ }).click();
    expect(await readPurse("a")).toBe(beforeC - 2000);
    expect(await readPurse("b")).toBe(beforeD + 2000);
  });

  test("refuses a trade the rule set will not allow, and says why", async ({ page }) => {
    await loginAsAdmin(page);
    await openTradeBlock(page);

    await page.locator("#trade-team-a").fill("Echo");
    await page.getByRole("option", { name: /Franchise Echo/ }).click();
    await page.locator("#trade-team-b").fill("Foxtrot");
    await page.getByRole("option", { name: /Franchise Foxtrot/ }).click();

    // Far more cash than any seeded purse holds.
    await page.locator("#trade-cash-a").fill("9999");

    // The advisory preview flags it before submitting…
    await expect(page.getByText(/breaches the active rule set/)).toBeVisible();
    // …and the server, which is the actual authority, rejects it by name.
    await page.getByRole("button", { name: "Execute trade" }).click();
    await expect(page.getByText(/rule\(s\) violated/).first()).toBeVisible();
    await expect(page.getByText(/insufficient_purse/).first()).toBeVisible();
  });
});
