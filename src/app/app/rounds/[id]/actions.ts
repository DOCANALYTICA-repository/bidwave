"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseRpcErrorCode } from "@/lib/validation/registration";

export type SubmitRoundFilesState = {
  status: "idle" | "error" | "success";
  formError?: string;
};

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

function hasAllowedFileType(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const hasAllowedMimeType = !file.type || ALLOWED_MIME_TYPES.includes(file.type);
  return hasAllowedExtension && hasAllowedMimeType;
}

/**
 * SUB-02/03/05: whole-set replacement. Files are uploaded via the
 * service-role admin client (same order as register_team()'s invoice
 * upload — team already has a session here, but the "submissions" bucket
 * still only grants direct write to admin, so uploads always go through
 * trusted server code), then submit_round_files() supersedes the prior set
 * atomically.
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
  const files = formData.getAll("files") as File[];
  const validFiles = files.filter((f) => f instanceof File && f.size > 0);

  if (validFiles.length < 1) {
    return { status: "error", formError: "At least one file is required." };
  }

  const disallowed = validFiles.find((f) => !hasAllowedFileType(f));
  if (disallowed) {
    return {
      status: "error",
      formError: `"${disallowed.name}" is not an allowed file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }

  const admin = createAdminClient();
  const uploaded: { storage_path: string; file_name: string; mime_type: string }[] = [];

  for (const file of validFiles) {
    const path = `${user.id}/${roundId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await admin.storage
      .from("submissions")
      .upload(path, file, { contentType: file.type || "application/octet-stream" });

    if (uploadError) {
      // Compensating cleanup for whatever uploaded successfully before the
      // failure (ERR-02: retain state, allow retry — the RPC hasn't run yet).
      await Promise.all(uploaded.map((u) => admin.storage.from("submissions").remove([u.storage_path])));
      return { status: "error", formError: "Upload failed. Please try again." };
    }

    uploaded.push({ storage_path: path, file_name: file.name, mime_type: file.type || "application/octet-stream" });
  }

  const { error } = await admin.rpc("submit_round_files", {
    p_team_id: user.id,
    p_round_id: roundId,
    p_files: uploaded,
  });

  if (error) {
    await Promise.all(uploaded.map((u) => admin.storage.from("submissions").remove([u.storage_path])));
    const parsed = parseRpcErrorCode(error.message);
    return { status: "error", formError: parsed?.message ?? "Submission failed. Please try again." };
  }

  revalidatePath(`/app/rounds/${roundId}`);
  revalidatePath("/app");
  return { status: "success" };
}
