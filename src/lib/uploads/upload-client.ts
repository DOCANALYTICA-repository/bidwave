"use client";

import { createClient } from "@/lib/supabase/client";
import type { UploadTarget } from "@/lib/uploads/types";

/**
 * Browser half of the direct-upload flow (see `direct-upload.ts` for why
 * the bytes no longer go through a Server Action).
 *
 * `uploadToSignedUrl` is authorized by the token alone, so the anon
 * browser client needs no insert policy on these private buckets — which
 * is why the buckets still grant direct writes to admin only.
 */
export async function uploadToTarget(target: UploadTarget, file: File): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(target.bucket)
    .uploadToSignedUrl(target.path, target.token, file, {
      contentType: file.type || "application/octet-stream",
    });

  if (!error) return null;

  // Storage enforces the bucket's own size/MIME ceiling, so this is the
  // path a genuinely oversized file takes now — a real message on the
  // form instead of a 500 from the Server Action (ERR-02).
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("exceeded") || message.includes("too large") || message.includes("maximum size")) {
    return "That file is larger than the maximum allowed size.";
  }
  if (message.includes("mime") || message.includes("content type")) {
    return "That file type isn't accepted.";
  }
  return "Upload failed. Please check your connection and try again.";
}
