import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Swapped per-test to simulate a browser with / without a preview cookie.
let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }),
}));

import { selectCurrentEdition, selectLiveEdition } from "@/lib/event-edition";
import { mintPreviewToken } from "@/lib/preview-mode";

/**
 * Captures which filter selectCurrentEdition applied. The real client is
 * never involved — the question under test is purely "is_active, or slug?".
 */
function stubClient() {
  const calls: { column: string; value: unknown }[] = [];
  const chain = {
    eq(column: string, value: unknown) {
      calls.push({ column, value });
      return chain;
    },
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return {
    calls,
    client: { from: () => ({ select: () => chain }) } as never,
  };
}

beforeEach(() => {
  process.env.BIDWAVE_PREVIEW_SECRET = "z".repeat(48);
  delete process.env.BIDWAVE_PREVIEW_DISABLED_AFTER;
  cookieValue = undefined;
});

afterEach(() => {
  delete process.env.BIDWAVE_PREVIEW_SECRET;
  delete process.env.BIDWAVE_PREVIEW_DISABLED_AFTER;
});

describe("selectCurrentEdition", () => {
  it("resolves the active edition when no preview cookie is present", async () => {
    const { client, calls } = stubClient();
    await selectCurrentEdition(client);
    expect(calls).toEqual([{ column: "is_active", value: true }]);
  });

  it("resolves the preview edition by slug when a valid preview cookie is present", async () => {
    cookieValue = mintPreviewToken()!;
    const { client, calls } = stubClient();
    await selectCurrentEdition(client);
    expect(calls).toEqual([{ column: "slug", value: "e2e-test" }]);
  });

  it("ignores a garbage cookie rather than throwing", async () => {
    cookieValue = "not-a-token";
    const { client, calls } = stubClient();
    await expect(selectCurrentEdition(client)).resolves.toBeDefined();
    expect(calls).toEqual([{ column: "is_active", value: true }]);
  });

  // The event-week kill switch has to beat a cookie that is otherwise valid.
  it("falls back to the active edition once the kill switch has passed", async () => {
    cookieValue = mintPreviewToken()!;
    process.env.BIDWAVE_PREVIEW_DISABLED_AFTER = "2020-01-01T00:00:00Z";

    const { client, calls } = stubClient();
    await selectCurrentEdition(client);
    expect(calls).toEqual([{ column: "is_active", value: true }]);
  });
});

describe("selectLiveEdition", () => {
  // Registration is public: a mis-scoped write there loses a real student's
  // entry, so it must never follow preview.
  it("stays on the active edition even with a valid preview cookie", async () => {
    cookieValue = mintPreviewToken()!;
    const { client, calls } = stubClient();
    await selectLiveEdition(client);
    expect(calls).toEqual([{ column: "is_active", value: true }]);
  });
});
