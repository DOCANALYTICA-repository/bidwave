/**
 * Shared between the server actions that mint upload targets and the
 * client helper that consumes them. Kept in its own module (no
 * `server-only`, no `"use client"`) so both sides can import the type.
 */
export type UploadBucket = "invoices" | "submissions" | "round-materials";

/**
 * A one-shot authorization to write exactly one object. `token` is what
 * Supabase Storage validates — it is scoped to `path` and expires, so
 * handing it to the browser grants no broader write access to the bucket.
 */
export type UploadTarget = {
  bucket: UploadBucket;
  path: string;
  token: string;
};
