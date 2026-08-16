"use client";

import type { UploadTarget } from "@/lib/uploads/types";

/**
 * Browser half of the direct-upload flow (see `direct-upload.ts` for why
 * the bytes no longer go through a Server Action).
 *
 * Driven with XMLHttpRequest against the signed-upload endpoint rather
 * than supabase-js's `uploadToSignedUrl`, for two things `fetch` cannot
 * give us and a submission deadline needs:
 *
 *  - **Progress.** 45MB takes ~68s to reach this project's Storage from a
 *    desktop on a good line (measured against the live project), and
 *    several minutes from a phone. With no byte counter the form could
 *    only say "Submitting…", so a team watching a perfectly healthy
 *    upload had no way to tell it from a hung one — the reported "stuck
 *    on Submitting for 10 minutes, then it went through".
 *  - **Stall detection and retry.** A dropped mobile connection leaves a
 *    plain fetch hanging until the OS gives up, and one dropped byte used
 *    to fail the whole submission. Here, a stretch with no progress event
 *    at all is treated as a dead connection and the file is retried.
 *
 * `PUT /object/upload/sign/<bucket>/<path>?token=…` is the same endpoint
 * `uploadToSignedUrl` writes to; verified against the live project, with
 * a raw body plus `content-type`, then re-read to confirm the stored
 * object keeps its real size and MIME type. The token alone authorizes
 * it, so no session header is involved and the anon browser client still
 * needs no insert policy on these private buckets.
 */

const MAX_ATTEMPTS = 3;
/**
 * No progress event *at all* for this long means the connection is gone —
 * not that the file is big. Deliberately generous: a phone on a weak cell
 * link still emits progress every few seconds while it is genuinely
 * uploading, so this only fires on a truly dead socket.
 */
const STALL_MS = 60_000;

/** Fraction of this file's bytes sent, 0–1. */
export type UploadProgress = (fraction: number) => void;

type Attempt = { ok: true } | { ok: false; message: string; retryable: boolean };

function attemptUpload(
  target: UploadTarget,
  file: File,
  onProgress?: UploadProgress,
): Promise<Attempt> {
  return new Promise((resolve) => {
    const endpoint =
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/` +
      `${target.bucket}/${target.path}?token=${encodeURIComponent(target.token)}`;

    const xhr = new XMLHttpRequest();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (attempt: Attempt) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      resolve(attempt);
    };

    // Rearmed on every progress event, so the clock measures silence, not
    // duration. `abort()` lands in onabort below and is retried.
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => xhr.abort(), STALL_MS);
    };

    xhr.open("PUT", endpoint, true);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    // A retry re-sends bytes to a path the failed attempt may already have
    // partially created; without upsert the second try would be refused as
    // a duplicate, which is the opposite of what a retry is for.
    xhr.setRequestHeader("x-upsert", "true");

    xhr.upload.onprogress = (event) => {
      armStall();
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    // The bytes are gone; what remains is the server's reply. Keep the
    // stall clock running so a server that never answers is retried too.
    xhr.upload.onload = () => armStall();

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        return finish({ ok: true });
      }
      // Storage enforces the bucket's own size/MIME ceiling, and the
      // project-wide 50MB object limit above it. Both are permanent for
      // this file — retrying only burns a team's remaining time.
      if (xhr.status === 413) {
        return finish({
          ok: false,
          retryable: false,
          message:
            "This file is larger than the 50MB we can store. Upload it to Google Drive and paste the sharing link below instead.",
        });
      }
      if (xhr.status === 415) {
        return finish({ ok: false, retryable: false, message: "That file type isn't accepted.", });
      }

      const body = (xhr.responseText ?? "").toLowerCase();
      if (body.includes("exceeded") || body.includes("maximum size") || body.includes("too large")) {
        return finish({
          ok: false,
          retryable: false,
          message:
            "This file is larger than the 50MB we can store. Upload it to Google Drive and paste the sharing link below instead.",
        });
      }
      if (body.includes("mime") || body.includes("content type")) {
        return finish({ ok: false, retryable: false, message: "That file type isn't accepted." });
      }
      // An expired or spent token can't be salvaged by retrying the same
      // one — the form has to mint fresh targets, which it does on the
      // next submit.
      if (xhr.status === 401 || xhr.status === 403) {
        return finish({
          ok: false,
          retryable: false,
          message: "This upload link expired. Press Submit again to start a fresh upload.",
        });
      }
      // 429 and 5xx are the server asking for a moment, not a verdict.
      finish({
        ok: false,
        retryable: true,
        message: "Upload failed. Please check your connection and try again.",
      });
    };

    xhr.onerror = () =>
      finish({
        ok: false,
        retryable: true,
        message: "Upload failed. Please check your connection and try again.",
      });
    xhr.onabort = () =>
      finish({
        ok: false,
        retryable: true,
        message: "The connection stalled during upload.",
      });

    armStall();
    xhr.send(file);
  });
}

/**
 * Uploads one file, retrying transient failures. Resolves to `null` on
 * success, or a message to show the team.
 *
 * `onProgress` is called with this file's fraction; a retry resets it to
 * 0, so the form's counter always reflects bytes actually in flight.
 */
export async function uploadToTarget(
  target: UploadTarget,
  file: File,
  onProgress?: UploadProgress,
): Promise<string | null> {
  let last = "Upload failed. Please check your connection and try again.";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await attemptUpload(target, file, onProgress);
    if (result.ok) return null;
    last = result.message;
    if (!result.retryable || attempt === MAX_ATTEMPTS) return last;

    onProgress?.(0);
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }

  return last;
}
