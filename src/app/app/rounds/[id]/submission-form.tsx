"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileDrop } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import {
  createSubmissionUploadTargets,
  submitRoundFiles,
  type SubmitRoundFilesState,
} from "@/app/app/rounds/[id]/actions";
import { uploadToTarget } from "@/lib/uploads/upload-client";

const initialState: SubmitRoundFilesState = { status: "idle" };

// Documents plus video deliverables. Must stay in step with
// ALLOWED_EXTENSIONS / ALLOWED_MIME_TYPES in ./actions.ts, which is the
// control — this is only the picker's filter.
const SUBMISSION_ACCEPT = ".pdf,.pptx,.docx,.xlsx,.mp4,.mov,.webm,.m4v,.mkv";

// The outer ceiling only — actions.ts holds the real, per-kind limits
// (250MB video / 50MB document) and reports an oversized document
// precisely, before any bytes are uploaded. Can't be imported: actions.ts
// is "use server", which may only export async functions. Surfaced here so
// a phone-sized video is rejected in the picker rather than after Storage
// refuses it (ERR-02).
// Raise to 250 together with MAX_VIDEO_BYTES in actions.ts once the
// project-wide Storage limit allows it — see the note there.
const MAX_SUBMISSION_BYTES = 50 * 1024 * 1024;

export function SubmissionForm({ roundId, disabled }: { roundId: string; disabled: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [state, formAction, isSubmitting] = useActionState(submitRoundFiles, initialState);
  // Files go browser → Storage before the action runs, so "busy" has to
  // cover the upload too (see lib/uploads/direct-upload.ts). A plain flag,
  // not useTransition — the upload must be awaited outside any transition.
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const isPending = isSubmitting || isUploading;

  useEffect(() => {
    if (state.status === "success") toast.success("Submission received.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state]);

  function handleSubmit() {
    setUploadError(null);
    void (async () => {
      setIsUploading(true);
      const fail = (message: string) => {
        setIsUploading(false);
        setUploadError(message);
        toast.error(message);
      };

      const result = await createSubmissionUploadTargets(
        roundId,
        files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      );
      if ("error" in result) return fail(result.error);

      const uploaded: { path: string; name: string; type: string }[] = [];
      for (const [index, target] of result.targets.entries()) {
        const file = files[index]!;
        const failure = await uploadToTarget(target, file);
        if (failure) return fail(`"${file.name}": ${failure}`);
        uploaded.push({ path: target.path, name: file.name, type: file.type });
      }

      const fd = new FormData();
      fd.set("roundId", roundId);
      fd.set("files", JSON.stringify(uploaded));

      // Synchronous dispatch inside a fresh transition — calling
      // formAction after an `await` runs the action "outside of a
      // transition", which leaves isPending stuck and drops the reply.
      setIsUploading(false);
      startTransition(() => formAction(fd));
    })();
  }

  return (
    <form
      action={handleSubmit}
      className="space-y-3"
    >
      <FileDrop
        value={files}
        onChange={setFiles}
        accept={SUBMISSION_ACCEPT}
        maxSizeBytes={MAX_SUBMISSION_BYTES}
        disabled={disabled || isPending}
      />
      {(uploadError || (state.status === "error" && state.formError)) && (
        <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
          {uploadError ?? state.formError}
        </p>
      )}
      {state.status === "success" && (
        <p className="rounded-lg border border-sold/30 bg-sold/10 px-3 py-2 text-sm text-sold">
          Submitted.
        </p>
      )}
      <Button type="submit" disabled={disabled || isPending || files.length === 0}>
        {isPending ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
