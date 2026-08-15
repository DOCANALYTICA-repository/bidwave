import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module is `server-only` and pulls in next/headers for the cookie read.
// Neither is needed for the pure token functions under test here.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import {
  PREVIEW_EDITION_SLUG,
  mintPreviewToken,
  previewWindowOpen,
  provisionPreviewTeam,
  verifyPreviewToken,
} from "@/lib/preview-mode";

const SECRET = "x".repeat(48);

beforeEach(() => {
  process.env.BIDWAVE_PREVIEW_SECRET = SECRET;
  delete process.env.BIDWAVE_PREVIEW_DISABLED_AFTER;
});

afterEach(() => {
  delete process.env.BIDWAVE_PREVIEW_SECRET;
  delete process.env.BIDWAVE_PREVIEW_DISABLED_AFTER;
  vi.useRealTimers();
});

describe("preview token", () => {
  it("round-trips", () => {
    const token = mintPreviewToken();
    expect(token).toBeTruthy();
    expect(verifyPreviewToken(token!)).toMatchObject({ v: 1, slug: PREVIEW_EDITION_SLUG });
  });

  it("rejects a tampered payload", () => {
    const [prefix, encoded, sig] = mintPreviewToken()!.split(".");
    const forged = Buffer.from(
      JSON.stringify({ v: 1, slug: "bidwave-2026", exp: 9999999999 }),
    ).toString("base64url");

    expect(verifyPreviewToken(`${prefix}.${forged}.${sig}`)).toBeNull();
    expect(encoded).not.toEqual(forged);
  });

  it("rejects a tampered signature without throwing on a length mismatch", () => {
    const token = mintPreviewToken()!;
    const [prefix, encoded, sig] = token.split(".");

    expect(verifyPreviewToken(`${prefix}.${encoded}.${sig.slice(0, -1)}`)).toBeNull();
    expect(verifyPreviewToken(`${prefix}.${encoded}.${sig}extra`)).toBeNull();
    expect(verifyPreviewToken(`${prefix}.${encoded}.`)).toBeNull();
  });

  it("rejects malformed tokens instead of throwing", () => {
    for (const bad of ["", "junk", "v1.only-two", "v2.a.b", "v1...", "....."]) {
      expect(() => verifyPreviewToken(bad)).not.toThrow();
      expect(verifyPreviewToken(bad)).toBeNull();
    }
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T10:00:00Z"));
    const token = mintPreviewToken()!;

    expect(verifyPreviewToken(token)).toBeTruthy();
    vi.setSystemTime(new Date("2026-08-14T12:00:01Z")); // past the 2h TTL
    expect(verifyPreviewToken(token)).toBeNull();
  });

  it("refuses to mint a token for an edition outside the compile-time allowlist", () => {
    expect(mintPreviewToken("bidwave-2026")).toBeNull();
  });

  it("is inert with no secret, and does not throw", () => {
    const token = mintPreviewToken()!;
    delete process.env.BIDWAVE_PREVIEW_SECRET;

    expect(mintPreviewToken()).toBeNull();
    expect(verifyPreviewToken(token)).toBeNull();
  });

  it("treats a too-short secret as no secret", () => {
    process.env.BIDWAVE_PREVIEW_SECRET = "short";
    expect(mintPreviewToken()).toBeNull();
  });

  it("does not verify a token signed under a different secret", () => {
    const token = mintPreviewToken()!;
    process.env.BIDWAVE_PREVIEW_SECRET = "y".repeat(48);
    expect(verifyPreviewToken(token)).toBeNull();
  });
});

describe("preview kill switch", () => {
  it("is open when no cutoff is configured", () => {
    expect(previewWindowOpen()).toBe(true);
  });

  it("closes once the cutoff has passed, and blocks both minting and verifying", () => {
    process.env.BIDWAVE_PREVIEW_DISABLED_AFTER = "2026-08-16T18:00:00+05:30";

    expect(previewWindowOpen(Date.parse("2026-08-15T09:00:00Z"))).toBe(true);
    expect(previewWindowOpen(Date.parse("2026-08-17T09:00:00Z"))).toBe(false);

    // An event-day token can be neither minted nor redeemed.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T09:00:00Z"));
    expect(mintPreviewToken()).toBeNull();
  });

  it("fails closed on an unparseable cutoff, so a typo cannot leave preview on", () => {
    process.env.BIDWAVE_PREVIEW_DISABLED_AFTER = "not-a-date";
    expect(previewWindowOpen()).toBe(false);
    expect(mintPreviewToken()).toBeNull();
  });
});

describe("provisionPreviewTeam", () => {
  function stubAdmin() {
    const upserts: { table: string; row: unknown; opts: unknown }[] = [];
    const client = {
      from: (table: string) => ({
        upsert: async (row: unknown, opts: unknown) => {
          upserts.push({ table, row, opts });
          return { error: null };
        },
      }),
    };
    return { client, upserts };
  }

  it("upserts a teams row keyed to the admin's own id, scoped to the given edition", async () => {
    const { client, upserts } = stubAdmin();
    await provisionPreviewTeam(client as never, "edition-1", "admin-uid", "admin@example.com");

    expect(upserts).toEqual([
      {
        table: "teams",
        row: {
          id: "admin-uid",
          event_edition_id: "edition-1",
          name: "Admin Preview — admin@example.com",
          campus: "Preview",
          captain_email: "admin@example.com",
          status: "active",
        },
        opts: { onConflict: "id" },
      },
    ]);
  });

  it("throws on a database error rather than swallowing it", async () => {
    const client = { from: () => ({ upsert: async () => ({ error: new Error("boom") }) }) };
    await expect(
      provisionPreviewTeam(client as never, "edition-1", "admin-uid", "admin@example.com"),
    ).rejects.toThrow("boom");
  });
});
