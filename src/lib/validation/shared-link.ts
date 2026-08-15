/**
 * Shape check for a shared-link submission — no network, so both the
 * submission form and the Server Action run the identical rules and a
 * team sees the same wording either side of the request.
 *
 * The server is still the authority: `isSharedLinkPrivate` in
 * `@/lib/uploads/shared-link` adds the reachability check that can't run
 * in the browser, and the action re-runs this parse on what was posted.
 */

const ALLOWED_HOSTS = [
  "drive.google.com",
  "docs.google.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
  "1drv.ms",
  "onedrive.live.com",
  "dropbox.com",
  "www.dropbox.com",
];

export type LinkCheck = { ok: true; url: string } | { ok: false; message: string };

export function parseSharedLink(raw: string): LinkCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: "Paste the sharing link." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      message: "That doesn't look like a link — paste the full URL, starting with https://",
    };
  }

  if (url.protocol !== "https:") {
    return { ok: false, message: "The link must start with https://" };
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) {
    return {
      ok: false,
      message:
        "Share the file from Google Drive and paste that link. (YouTube, Vimeo, OneDrive and Dropbox links are also accepted.)",
    };
  }

  // Strip credentials and fragment — nothing downstream needs them, and the
  // link is shown to judges and written into exports.
  url.username = "";
  url.password = "";
  url.hash = "";
  return { ok: true, url: url.toString() };
}
