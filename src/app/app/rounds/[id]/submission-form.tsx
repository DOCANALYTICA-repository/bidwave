"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileDrop } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { submitRoundFiles, type SubmitRoundFilesState } from "@/app/app/rounds/[id]/actions";

const initialState: SubmitRoundFilesState = { status: "idle" };

export function SubmissionForm({ roundId, disabled }: { roundId: string; disabled: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [state, formAction, isPending] = useActionState(submitRoundFiles, initialState);

  useEffect(() => {
    if (state.status === "success") toast.success("Submission received.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state]);

  return (
    <form
      action={(fd) => {
        fd.set("roundId", roundId);
        for (const file of files) fd.append("files", file);
        formAction(fd);
      }}
      className="space-y-3"
    >
      <FileDrop
        value={files}
        onChange={setFiles}
        accept=".pdf,.pptx,.docx,.xlsx"
        disabled={disabled || isPending}
      />
      {state.status === "error" && state.formError && (
        <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
          {state.formError}
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
