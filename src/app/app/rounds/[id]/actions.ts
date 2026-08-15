"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseRpcErrorCode } from "@/lib/validation/registration";
import {
  createUploadTarget,
  removeUploadedObjects,
  verifyUploadedObject,
} from "@/lib/uploads/direct-upload";
import type { UploadTarget } from "@/lib/uploads/types";
import { parseSharedLink } from "@/lib/validation/shared-link";
import { isSharedLinkUnviewable } from "@/lib/uploads/shared-link";

export type SubmitRoundFilesState = {
  status: "idle" | "error" | "success";
  formError?: string;
};

// A round deck is routinely tens of megabytes; the only ceiling that
// applies now is the bucket's own (migration 20260815100000…), surfaced
// here so the server rejects an over-limit object rather than recording a
// row for something Storage refused. Video gets the full bucket ceiling —
// a few minutes of footage clears 50MB easily — while documents keep the
// tighter one, since a 250MB deck is a mistake, not a submission.
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
// Intended to be 250MB (the bucket is already set to it — migration
// 20260815100000), but the *project-wide* Storage upload limit currently
// caps every object at 50MB regardless of the bucket's own setting:
// verified by direct upload against the live project with the bucket at
// 250MB — 50MB succeeded, 60MB was refused with "The object exceeded the
// maximum allowed size". That global limit lives in the Supabase dashboard
// (Project Settings → Storage), and raising it past 50MB requires a paid
// plan. Once it is raised, this becomes 250 and the value below in
// submission-form.tsx with it — nothing else changes.
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_SUBMISSION_FILES = 10;

// Audit high-priority #18: only the client's `accept=` list
// (submission-form.tsx) constrained upload type — trivially bypassable via
// a direct form-data POST. Mirrors that same allowlist server-side.
// Video formats are accepted for rounds whose deliverable is a recording;
// keep this list and SUBMISSION_ACCEPT in submission-form.tsx in step.
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v", ".mkv"];
const DOCUMENT_EXTENSIONS = [".pdf", ".pptx", ".docx", ".xlsx"];
const ALLOWED_EXTENSIONS = [...DOCUMENT_EXTENSIONS, ...VIDEO_EXTENSIONS];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/x-matroska",
];

function hasAllowedFileType(file: { name: string; type: string }): boolean {
  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const hasAllowedMimeType = !file.type || ALLOWED_MIME_TYPES.includes(file.type);
  return hasAllowedExtension && hasAllowedMimeType;
}

/**
 * The size ceiling depends on the kind of file, and the extension is what
 * decides it — the browser-reported MIME type is absent often enough
 * (see hasAllowedFileType) that it can't carry this. A file that reaches
 * here has already passed the allowlist, so anything not a known video
 * extension is a document.
 */
function maxBytesForFile(name: string): number {
  const lowerName = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
    ? MAX_VIDEO_BYTES
    : MAX_DOCUMENT_BYTES;
}

/**
 * An over-cap file is a dead end unless the team is told what to do about
 * it, so the limit and the way around it arrive in the same sentence
 * (ERR-02). The form says this too, before any bytes move; this is the
 * copy a direct POST gets.
 */
function oversizeMessage(name: string): string {
  const mb = maxBytesForFile(name) / (1024 * 1024);
  return `"${name}" is larger than ${mb}MB, which is the most we can store. Upload it to Google Drive, set sharing to "Anyone with the link", and submit the link instead.`;
}

/**
 * `file_name` is what judges and exports show, and a link row has no file
 * to take one from — so fall back to the host when the team didn't label
 * it ("drive.google.com" reads better in a submissions list than a 60-char
 * opaque URL).
 */
function linkFileName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Shared link";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Step 1 of a submission: the browser uploads each file straight to
 * Storage against a server-minted target, then posts only the paths.
 * Sending the files through the Server Action itself capped submissions at
 * 1MB — see `lib/uploads/direct-upload.ts`.
 *
 * Targets are minted only under `<team>/<round>/`, so a team can never
 * obtain a write token for another team's prefix, and the type allowlist
 * is applied here as well as on the way in (SUB: client `accept=` is not a
 * control).
 */
export async function createSubmissionUploadTargets(
  roundId: string,
  files: { name: string; type: string; size: number }[],
): Promise<{ targets: UploadTarget[] } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  if (!UUID_RE.test(roundId)) return { error: "Unknown round." };
  if (files.length < 1) return { error: "At least one file is required." };
  if (files.length > MAX_SUBMISSION_FILES) {
    return { error: `At most ${MAX_SUBMISSION_FILES} files can be submitted at once.` };
  }

  const disallowed = files.find((f) => !hasAllowedFileType(f));
  if (disallowed) {
    return {
      error: `"${disallowed.name}" is not an allowed file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }

  const empty = files.find((f) => f.size <= 0);
  if (empty) return { error: `"${empty.name}" is empty.` };

  const oversized = files.find((f) => f.size > maxBytesForFile(f.name));
  if (oversized) return { error: oversizeMessage(oversized.name) };

  const dir = `${user.id}/${roundId}`;
  const targets: UploadTarget[] = [];
  for (const file of files) {
    const target = await createUploadTarget("submissions", dir, file.name);
    if (!target) {
      await removeUploadedObjects("submissions", targets.map((t) => t.path));
      return { error: "Could not start the upload. Please try again." };
    }
    targets.push(target);
  }
  return { targets };
}

/**
 * SUB-02/03/05: whole-set replacement. Step 2 of the upload — the browser
 * has already written each object to the "submissions" bucket against a
 * target minted by createSubmissionUploadTargets() above, so this receives
 * paths only and submit_round_files() supersedes the prior set atomically.
 */
export async function submitRoundFiles(
  _prevState: SubmitRoundFilesState,
  formData: FormData,
): Promise<SubmitRoundFilesState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", formError: "You must be signed in." };

  const roundId = String(formData.get("roundId") ?? "");
  if (!UUID_RE.test(roundId)) return { status: "error", formError: "Unknown round." };

  let claimed: { path: string; name: string; type: string }[];
  let claimedLinks: { url: string; label: string }[];
  try {
    claimed = JSON.parse(String(formData.get("files") ?? "[]"));
    claimedLinks = JSON.parse(String(formData.get("links") ?? "[]"));
  } catch {
    return { status: "error", formError: "Invalid submission — please refresh and try again." };
  }

  if (!Array.isArray(claimed)) claimed = [];
  if (!Array.isArray(claimedLinks)) claimedLinks = [];

  // A submission is a set of entries — uploaded objects, shared links, or
  // both. Only the total has to be non-empty.
  if (claimed.length + claimedLinks.length < 1) {
    return { status: "error", formError: "Add at least one file or link." };
  }
  if (claimed.length + claimedLinks.length > MAX_SUBMISSION_FILES) {
    return {
      status: "error",
      formError: `At most ${MAX_SUBMISSION_FILES} files and links can be submitted at once.`,
    };
  }

  const disallowed = claimed.find((f) => !hasAllowedFileType(f));
  if (disallowed) {
    return {
      status: "error",
      formError: `"${disallowed.name}" is not an allowed file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }

  // Links are re-parsed here rather than trusted from the form: the
  // client-side check is UX, this is the control (same module, same
  // wording, so a team never sees two different rejections for one paste).
  const entries: {
    storage_path?: string;
    file_name: string;
    mime_type?: string;
    external_url?: string;
  }[] = [];

  for (const link of claimedLinks) {
    const parsed = parseSharedLink(String(link?.url ?? ""));
    if (!parsed.ok) return { status: "error", formError: parsed.message };

    if (await isSharedLinkUnviewable(parsed.url)) {
      return {
        status: "error",
        formError:
          "We couldn't open that link — it asks for sign-in, or doesn't exist. In Google Drive, open Share → General access, set it to \"Anyone with the link\" as Viewer, copy the link again, then submit.",
      };
    }

    entries.push({
      external_url: parsed.url,
      file_name: String(link?.label ?? "").trim() || linkFileName(parsed.url),
    });
  }

  // `expectedPrefix` is the ownership check: a path outside this team's
  // own round folder is refused before it can be recorded, no matter what
  // the client posted.
  const allPaths = claimed.map((f) => f.path);

  for (const file of claimed) {
    const verified = await verifyUploadedObject("submissions", file.path, {
      expectedPrefix: `${user.id}/${roundId}`,
      maxBytes: maxBytesForFile(file.name),
    });
    if (!verified) {
      await removeUploadedObjects("submissions", allPaths);
      return {
        status: "error",
        formError: `We couldn't read "${file.name}" after upload. Please try again.`,
      };
    }
    entries.push({
      storage_path: file.path,
      file_name: file.name,
      mime_type: verified.contentType,
    });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("submit_round_files", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_files: entries,
  });

  if (error) {
    await removeUploadedObjects("submissions", allPaths);
    const parsed = parseRpcErrorCode(error.message);
    return { status: "error", formError: parsed?.message ?? "Submission failed. Please try again." };
  }

  revalidatePath(`/app/rounds/${roundId}`);
  revalidatePath("/app");
  return { status: "success" };
}
