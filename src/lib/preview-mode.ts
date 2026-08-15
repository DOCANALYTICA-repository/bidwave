import "server-only";
import { cache } from "react";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Admin-only "live rounds preview": repoints the app at the non-active
 * `e2e-test` edition for one browser, so the simulation can be rehearsed
 * against the deployed production URL without touching a single row of the
 * live edition.
 *
 * The admin plays *as themselves* — there is no separate demo team account.
 * Entering preview provisions a teams row keyed to the admin's own auth uid
 * (see provisionPreviewTeam below), so their own session can submit a
 * simulation attempt like any other team. Because it's the same browser and
 * the same login throughout, there is no link to copy or redeem: entering
 * and exiting are both same-tab server actions that set/clear one cookie.
 *
 * Deliberately narrower than the BIDWAVE_EVENT_EDITION_SLUG env var it sits
 * beside (src/lib/event-edition.ts): that one is global and stays disabled in
 * production, this one is a signed, self-expiring, per-browser cookie an
 * admin has to mint explicitly.
 *
 * The token confers *no privilege* beyond what admin already has. It only
 * changes which event_edition_id rows a query selects — every RLS policy and
 * SECURITY DEFINER RPC applies exactly as it does without it. That is why
 * replay inside the TTL is acceptable and why there is no nonce store.
 *
 * Three independent things must all hold for preview to exist at all, so the
 * default state everywhere — and the state after the event — is "off":
 *   1. BIDWAVE_PREVIEW_SECRET is set,
 *   2. now < BIDWAVE_PREVIEW_DISABLED_AFTER (if that var is set),
 *   3. the browser holds a valid, unexpired cookie.
 * With the secret unset, this module is inert and behaviour is byte-identical
 * to having never shipped it.
 *
 * AUCTION IS OUT OF SCOPE ON PURPOSE. The public /live ticker queries
 * public_sales_feed, a view that does not expose event_edition_id, so a
 * rehearsal sale would appear on the public ticker. Rather than change that
 * view days before the event, isAuctionWriteBlocked() below refuses auction
 * mutations while preview is active — see src/app/admin/auction/console/actions.ts.
 */
export const PREVIEW_COOKIE = "bidwave_preview";

/**
 * Compile-time allowlist. Even with a fully compromised secret, a token can
 * never name the live edition — this is the property that makes the whole
 * mechanism safe, more so than the HMAC itself.
 */
export const PREVIEW_EDITION_SLUGS = ["e2e-test"] as const;
export const PREVIEW_EDITION_SLUG = PREVIEW_EDITION_SLUGS[0];

export const PREVIEW_TTL_SECONDS = 2 * 60 * 60;

export type PreviewPayload = {
  v: 1;
  slug: string;
  exp: number;
};

function previewSecret(): string | null {
  // Intentionally not src/lib/supabase/env.ts's `required()` — a missing
  // secret must disable the feature, not throw on every request.
  const secret = process.env.BIDWAVE_PREVIEW_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

/**
 * Hard kill switch. Set BIDWAVE_PREVIEW_DISABLED_AFTER to an ISO instant
 * before the event (e.g. 2026-08-16T18:00:00+05:30) and preview cannot
 * resolve during 17-19 Aug no matter what any cookie says. This is the only
 * safeguard that does not depend on a human noticing a banner.
 */
export function previewWindowOpen(now: number = Date.now()): boolean {
  const cutoff = process.env.BIDWAVE_PREVIEW_DISABLED_AFTER;
  if (!cutoff) return true;

  const cutoffMs = Date.parse(cutoff);
  // An unparseable cutoff fails closed — a typo in this var must not silently
  // leave preview enabled through the event.
  if (Number.isNaN(cutoffMs)) return false;
  return now < cutoffMs;
}

function sign(encodedPayload: string, key: string): string {
  return createHmac("sha256", key).update(encodedPayload).digest("base64url");
}

export function mintPreviewToken(slug: string = PREVIEW_EDITION_SLUG): string | null {
  const key = previewSecret();
  if (!key || !previewWindowOpen()) return null;
  if (!(PREVIEW_EDITION_SLUGS as readonly string[]).includes(slug)) return null;

  const payload: PreviewPayload = {
    v: 1,
    slug,
    exp: Math.floor(Date.now() / 1000) + PREVIEW_TTL_SECONDS,
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `v1.${encoded}.${sign(`v1.${encoded}`, key)}`;
}

export function verifyPreviewToken(token: string): PreviewPayload | null {
  const key = previewSecret();
  if (!key || !previewWindowOpen()) return null;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, encoded, signature] = parts as [string, string, string];

  // Verify before parsing: nothing attacker-controlled reaches JSON.parse
  // until the HMAC says the payload is ours. timingSafeEqual throws on a
  // length mismatch, so guard the length explicitly first.
  const provided = Buffer.from(signature);
  const expected = Buffer.from(sign(`v1.${encoded}`, key));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreviewPayload;

    if (payload?.v !== 1) return null;
    if (typeof payload.slug !== "string") return null;
    if (!(PREVIEW_EDITION_SLUGS as readonly string[]).includes(payload.slug)) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * The single read path, consulted by selectCurrentEdition() on every request.
 * cache()d because that helper has ~65 call sites: without this the HMAC
 * verify would run per call rather than per request, and — more importantly —
 * the banner, the auction interlock and the edition lookup would each be free
 * to observe a different answer if the token expired mid-render.
 */
export const getPreviewSession = cache(async (): Promise<PreviewPayload | null> => {
  if (!previewSecret() || !previewWindowOpen()) return null;

  let token: string | undefined;
  try {
    token = (await cookies()).get(PREVIEW_COOKIE)?.value;
  } catch {
    // No request scope (e.g. a build-time render). Preview is per-request
    // browser state by definition, so "off" is the only correct answer.
    return null;
  }
  if (!token) return null;

  return verifyPreviewToken(token);
});

export async function previewEditionSlug(): Promise<string | undefined> {
  return (await getPreviewSession())?.slug;
}

export async function isPreviewActive(): Promise<boolean> {
  return (await getPreviewSession()) !== null;
}

/**
 * Auction writes are refused while preview is active, because the public
 * /live ticker reads public_sales_feed — a view with no event_edition_id
 * column, so that query cannot be edition-filtered and a rehearsal sale would
 * surface on the public ticker. Blocking the write is a guarantee; a note in
 * the runbook is not.
 *
 * To lift this: add s.event_edition_id to the public_sales_feed view, filter
 * on it in src/app/(public)/live/page.tsx, hand-sync src/lib/supabase/types.ts
 * (types are hand-written until Docker is fixed — see CLAUDE.md), then delete
 * this guard and its six call sites in
 * src/app/admin/auction/console/actions.ts.
 */
export const AUCTION_BLOCKED_IN_PREVIEW =
  "Auction actions are disabled in preview mode — a rehearsal sale would appear on the public live ticker. Exit preview to run the auction.";

export async function isAuctionWriteBlocked(): Promise<boolean> {
  return isPreviewActive();
}

/**
 * Lets the admin play the simulation as themselves: upserts a teams row keyed
 * to their own auth uid, scoped to the preview edition, so
 * submit_simulation_attempt's FK on team_id has something to reference.
 *
 * No team_members row is created — nothing in the simulation path joins
 * team_members, and creating one would need register-number/phone/email
 * fields that don't apply to an admin acting solo.
 *
 * The team name embeds the admin's email because `teams` has a
 * (event_edition_id, name) uniqueness constraint — a second admin entering
 * preview must not collide with the first.
 */
export async function provisionPreviewTeam(
  admin: SupabaseClient<Database>,
  eventEditionId: string,
  adminUserId: string,
  adminEmail: string,
): Promise<void> {
  const { error } = await admin.from("teams").upsert(
    {
      id: adminUserId,
      event_edition_id: eventEditionId,
      name: `Admin Preview — ${adminEmail}`,
      campus: "Preview",
      captain_email: adminEmail,
      status: "active",
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}
