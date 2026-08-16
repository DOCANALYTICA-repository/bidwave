import "server-only";
import { logger } from "@/lib/logger";

/**
 * Reachability half of a shared-link submission (the shape half lives in
 * `@/lib/validation/shared-link`, which the form shares).
 *
 * Storage on this project rejects any object over 50MB — a project-wide
 * limit, see migration 20260815100000 — which a video deliverable clears
 * easily. Over the cap a team shares the file from Google Drive and
 * submits the link, so the question that matters is whether a signed-out
 * visitor can actually open it: the failure this catches is a judge
 * hitting a permission wall during scoring, long after the round closed
 * and the team could fix it.
 *
 * This depends on the network, so it fails **open**: only an unambiguous
 * "this is private" verdict blocks a submission. A timeout or an odd
 * status must never be the reason a team can't submit before a deadline.
 */
export async function isSharedLinkUnviewable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: {
        // Some hosts serve a different, auth-gated response to a bare
        // client; ask as a browser would so the verdict matches what a
        // judge will actually see.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });

    // 404/410: Drive answers this way for a file that isn't shared (it
    // won't confirm the object exists to a stranger), and for one that was
    // deleted or whose link was mistyped. All three are the same thing
    // from a judge's seat — the link does not open.
    //
    // 401/403 are deliberately *not* on this list. They are what Google
    // and Dropbox return to an unfamiliar datacenter IP under rate
    // limiting as well as to a genuinely private file, and a serverless
    // function's egress address is exactly that. Blocking on an ambiguous
    // status would turn a busy submission window into a wall of teams who
    // cannot submit a link that opens perfectly well in a browser — a far
    // worse failure than a judge having to ask one team to re-share.
    if ([404, 410].includes(response.status)) return true;

    // A sign-in wall is a 200 serving the login page, so the give-away is
    // the final URL, not the status. Verified against a Google URL that
    // requires auth: it lands on accounts.google.com.
    const finalHost = new URL(response.url).hostname.toLowerCase();
    if (finalHost === "accounts.google.com" || finalHost.endsWith("login.live.com")) {
      return true;
    }
    return false;
  } catch (error) {
    logger.warn("shared_link_probe_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
