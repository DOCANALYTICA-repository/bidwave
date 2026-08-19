import { test, expect } from "@playwright/test";
import { loginAsAdmin, ADMIN_EMAIL, putPlayerUpForBidding } from "../fixtures";

/**
 * AUC-13..16: the record-lock is advisory only (doesn't gate record_sale/
 * reverse_sale — see record_locks' table comment in
 * supabase/migrations/20260730080000_auction.sql) but must still visibly
 * warn a second device. AUC-13 means one shared admin account across every
 * device, so both contexts here log in as the same admin — device
 * distinction comes from console-lock-badge.tsx's client-generated
 * session_token, not auth.uid(). The device label console-sale-entry.tsx
 * passes is the fixed literal "Console", combined server-side with the
 * admin's email (acquireRecordLock in console/actions.ts), so the exact
 * badge text is deterministic: "Being edited on Console (<admin email>)".
 */
test.describe("auction record locks", () => {
  test("a second admin device sees the record-locked badge", async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await loginAsAdmin(pageA);
    // Need a player up for bidding for the console lock badge to even mount.
    await putPlayerUpForBidding(pageA);

    // First device: acquires the lock cleanly, so no "being edited" badge.
    await expect(pageA.getByText(/Being edited on/)).toHaveCount(0);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await loginAsAdmin(pageB);
    await pageB.goto("/admin/auction/console");

    // Second device: acquire_record_lock() rejects while the first device's
    // heartbeat is still fresh (< 20s TTL) — the badge should appear
    // immediately on mount.
    await expect(pageB.getByText(`Being edited on Console (${ADMIN_EMAIL})`)).toBeVisible({ timeout: 10_000 });

    await contextA.close();
    await contextB.close();
  });
});
