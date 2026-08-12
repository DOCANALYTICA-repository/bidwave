"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
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

export function SubmissionForm({ roundId, disabled }: { roundId: string; disabled: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [state, formAction, isSubmitting] = useActionState(submitRoundFiles, initialState);
  // Files go browser → Storage before the action runs, so "busy" has to
  // cover the upload too (see lib/uploads/direct-upload.ts).
  const [isUploading, startUpload] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const isPending = isSubmitting || isUploading;

  useEffect(() => {
    if (state.status === "success") toast.success("Submission received.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state]);

  function handleSubmit() {
    setUploadError(null);
    startUpload(async () => {
      const result = await createSubmissionUploadTargets(
        roundId,
        files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      );
      if ("error" in result) {
        setUploadError(result.error);
        toast.error(result.error);
        return;
      }

      const uploaded: { path: string; name: string; type: string }[] = [];
      for (const [index, target] of result.targets.entries()) {
        const file = files[index]!;
        const failure = await uploadToTarget(target, file);
        if (failure) {
          const message = `"${file.name}": ${failure}`;
          setUploadError(message);
          toast.error(message);
          return;
        }
        uploaded.push({ path: target.path, name: file.name, type: file.type });
      }

      const fd = new FormData();
      fd.set("roundId", roundId);
      fd.set("files", JSON.stringify(uploaded));
      formAction(fd);
    });
  }

  return (
    <form
      action={handleSubmit}
      className="space-y-3"
    >
      <FileDrop
        value={files}
        onChange={setFiles}
        accept=".pdf,.pptx,.docx,.xlsx"
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
