import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { UploadBucket, UploadTarget } from "@/lib/uploads/types";

/**
 * Direct browser → Supabase Storage uploads.
 *
 * File bytes used to travel through the Server Action itself (the action
 * received a `File` off FormData and re-uploaded it with the service-role
 * client). That silently capped every upload in the app at **1 MB** —
 * Next's `serverActions.bodySizeLimit` default — and blew up as an
 * unhandled 413 inside the action, i.e. a bare "Something went wrong"
 * error boundary with no field-level message. Registration (10 MB of
 * allowed payment proof) and round submissions (uncapped decks) were both
 * unusable for any real-world file. Raising `bodySizeLimit` alone would
 * not have fixed it either: Vercel caps a serverless function's request
 * body at 4.5 MB regardless of framework config.
 *
 * So the bytes no longer touch our server. A Server Action mints a signed
 * upload target for one specific object path, the browser PUTs straight to
 * Storage, and the action that follows receives only the path — a few
 * hundred bytes of form data. The server still decides *every* path (the
 * client never proposes one) and re-reads the stored object's real size
 * and MIME type afterward, so a client that lies about what it uploaded
 * gets rejected on the server side, same as before.
 */

/** Extension taken from the client's file name — never the path itself. */
function safeExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return match ? `.${match[1].toLowerCase()}` : "";
}

/**
 * Mints a signed upload URL for a server-chosen path inside `dir`.
 * The object name is a UUID: the caller's file name is only ever used for
 * its extension, so a hostile name can't traverse out of `dir` or collide
 * with another team's object.
 */
export async function createUploadTarget(
  bucket: UploadBucket,
  dir: string,
  fileName: string,
): Promise<UploadTarget | null> {
  const admin = createAdminClient();
  const path = `${dir}/${randomUUID()}${safeExtension(fileName)}`;

  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) {
    logger.error("upload_target_failed", { bucket, dir, message: error?.message });
    return null;
  }
  return { bucket, path: data.path, token: data.token };
}

export type VerifiedUpload = { size: number; contentType: string };

/**
 * Re-reads what actually landed in Storage. The browser is the one that
 * performed the upload, so the size/MIME it claimed in the form is not
 * evidence of anything — this is the check that counts.
 *
 * `expectedPrefix` is the caller's ownership assertion: the action passes
 * the directory it minted the target under, so a client replaying someone
 * else's path (or a path from a different round/team) is rejected before
 * any database row references it.
 */
export async function verifyUploadedObject(
  bucket: UploadBucket,
  path: string,
  opts: { expectedPrefix: string; maxBytes: number; allowedMimeTypes?: readonly string[] },
): Promise<VerifiedUpload | null> {
  if (!path.startsWith(`${opts.expectedPrefix}/`) || path.includes("..")) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).info(path);
  if (error || !data) return null;

  const size = data.size ?? 0;
  const contentType = data.contentType ?? "application/octet-stream";

  if (size <= 0 || size > opts.maxBytes) return null;
  if (opts.allowedMimeTypes && !opts.allowedMimeTypes.includes(contentType)) return null;

  return { size, contentType };
}

/** Best-effort compensating cleanup — never throws into the caller's path. */
export async function removeUploadedObjects(bucket: UploadBucket, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin.storage.from(bucket).remove(paths);
  if (error) logger.error("upload_cleanup_failed", { bucket, paths, message: error.message });
}

/**
 * Moves an object minted under a staging directory to its final,
 * RLS-meaningful location. Registration needs this: the invoice is
 * uploaded before the captain's auth user exists, but the `invoices`
 * bucket's read policy keys off `foldername(name)[1] = auth.uid()`.
 */
export async function moveUploadedObject(
  bucket: UploadBucket,
  fromPath: string,
  toPath: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(bucket).move(fromPath, toPath);
  if (error) {
    logger.error("upload_move_failed", { bucket, fromPath, toPath, message: error.message });
    return false;
  }
  return true;
}
