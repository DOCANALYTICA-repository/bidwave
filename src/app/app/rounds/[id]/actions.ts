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

export type SubmitRoundFilesState = {
  status: "idle" | "error" | "success";
  formError?: string;
};

// A round deck is routinely tens of megabytes; the only ceiling that
// applies now is the bucket's own (migration 20260812…), surfaced here so
// the server rejects an over-limit object rather than recording a row for
// something Storage refused.
const MAX_SUBMISSION_BYTES = 50 * 1024 * 1024;
const MAX_SUBMISSION_FILES = 10;

// Audit high-priority #18: only the client's `accept=".pdf,.pptx,.docx,.xlsx"`
// (submission-form.tsx) constrained upload type — trivially bypassable via
// a direct form-data POST. Mirrors that same allowlist server-side.
const ALLOWED_EXTENSIONS = [".pdf", ".pptx", ".docx", ".xlsx"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

function hasAllowedFileType(file: { name: string; type: string }): boolean {
  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const hasAllowedMimeType = !file.type || ALLOWED_MIME_TYPES.includes(file.type);
  return hasAllowedExtension && hasAllowedMimeType;
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

  const oversized = files.find((f) => f.size <= 0 || f.size > MAX_SUBMISSION_BYTES);
  if (oversized) {
    return {
      error: `"${oversized.name}" is empty or larger than ${MAX_SUBMISSION_BYTES / (1024 * 1024)}MB.`,
    };
  }

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
  try {
    claimed = JSON.parse(String(formData.get("files") ?? "[]"));
  } catch {
    return { status: "error", formError: "Invalid submission — please refresh and try again." };
  }

  if (!Array.isArray(claimed) || claimed.length < 1) {
    return { status: "error", formError: "At least one file is required." };
  }
  if (claimed.length > MAX_SUBMISSION_FILES) {
    return {
      status: "error",
      formError: `At most ${MAX_SUBMISSION_FILES} files can be submitted at once.`,
    };
  }

  const disallowed = claimed.find((f) => !hasAllowedFileType(f));
  if (disallowed) {
    return {
      status: "error",
      formError: `"${disallowed.name}" is not an allowed file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }

  // `expectedPrefix` is the ownership check: a path outside this team's
  // own round folder is refused before it can be recorded, no matter what
  // the client posted.
  const uploaded: { storage_path: string; file_name: string; mime_type: string }[] = [];
  const allPaths = claimed.map((f) => f.path);

  for (const file of claimed) {
    const verified = await verifyUploadedObject("submissions", file.path, {
      expectedPrefix: `${user.id}/${roundId}`,
      maxBytes: MAX_SUBMISSION_BYTES,
    });
    if (!verified) {
      await removeUploadedObjects("submissions", allPaths);
      return {
        status: "error",
        formError: `We couldn't read "${file.name}" after upload. Please try again.`,
      };
    }
    uploaded.push({
      storage_path: file.path,
      file_name: file.name,
      mime_type: verified.contentType,
    });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("submit_round_files", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_files: uploaded,
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
