"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link as LinkIcon, X } from "lucide-react";
import { FileDrop } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseSharedLink } from "@/lib/validation/shared-link";
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

// Mirrors the per-kind limits in actions.ts, which remains the control.
// Can't be imported — actions.ts is "use server", which may only export
// async functions. Applied here so an over-cap video is caught in the
// picker, with the way around it offered in the same breath, rather than
// failing partway through an upload (ERR-02).
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

  // Shared links, for files over the upload cap. `linkDraft` is the one
  // being typed; committed links move into `links`, so a team can submit a
  // link and a deck together.
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  // Set when the picker turns a file away for being too big — this is what
  // turns the limit from a dead end into an instruction.
  const [oversizeNotice, setOversizeNotice] = useState<string | null>(null);
  const showLinkField = links.length > 0 || oversizeNotice !== null;

  useEffect(() => {
    if (state.status === "success") toast.success("Submission received.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state]);

  // Emptying the staged set after a success is the point: a submission
  // replaces the whole prior set (SUB-02/03), so leaving the last files and
  // links in the form makes a second, unrelated submission silently
  // re-send them. Reacting to the action's result is exactly what an effect
  // is for here — there is no event to hang it on.
  useEffect(() => {
    if (state.status !== "success") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setFiles([]);
    setLinks([]);
    setLinkDraft("");
    setOversizeNotice(null);
  }, [state.status]);

  function handleOversize(rejected: File[]) {
    const names = rejected.map((f) => f.name).join(", ");
    setOversizeNotice(
      `${names} ${rejected.length === 1 ? "is" : "are"} over the ${
        MAX_SUBMISSION_BYTES / (1024 * 1024)
      }MB upload limit — too large for us to store.`,
    );
  }

  function addLink() {
    const parsed = parseSharedLink(linkDraft);
    if (!parsed.ok) return setLinkError(parsed.message);
    if (links.includes(parsed.url)) {
      setLinkDraft("");
      return setLinkError("That link has already been added.");
    }
    setLinks([...links, parsed.url]);
    setLinkDraft("");
    setLinkError(null);
  }

  function handleSubmit() {
    setUploadError(null);
    void (async () => {
      setIsUploading(true);
      const fail = (message: string) => {
        setIsUploading(false);
        setUploadError(message);
        toast.error(message);
      };

      // A links-only submission still has to reach the action, so minting
      // targets is skipped rather than called with an empty list.
      const uploaded: { path: string; name: string; type: string }[] = [];
      if (files.length > 0) {
        const result = await createSubmissionUploadTargets(
          roundId,
          files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
        );
        if ("error" in result) return fail(result.error);

        for (const [index, target] of result.targets.entries()) {
          const file = files[index]!;
          const failure = await uploadToTarget(target, file);
          if (failure) return fail(`"${file.name}": ${failure}`);
          uploaded.push({ path: target.path, name: file.name, type: file.type });
        }
      }

      const fd = new FormData();
      fd.set("roundId", roundId);
      fd.set("files", JSON.stringify(uploaded));
      fd.set("links", JSON.stringify(links.map((url) => ({ url, label: "" }))));

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
        onOversize={handleOversize}
        disabled={disabled || isPending}
      />

      {oversizeNotice && (
        <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-3 text-sm">
          <p className="font-medium text-foreground">{oversizeNotice}</p>
          <p className="mt-1 text-ink-2">
            Upload it to Google Drive instead, then paste the sharing link below. Set{" "}
            <span className="text-foreground">Share → General access</span> to{" "}
            <span className="text-foreground">Anyone with the link</span>
            {" (Viewer), or the judges won't be able to open it."}
          </p>
        </div>
      )}

      {showLinkField && (
        <div className="space-y-2">
          <label htmlFor="submission-link" className="block text-sm font-medium text-foreground">
            Sharing link
          </label>
          <div className="flex gap-2">
            <Input
              id="submission-link"
              type="url"
              inputMode="url"
              placeholder="https://drive.google.com/…"
              value={linkDraft}
              disabled={disabled || isPending}
              onChange={(e) => {
                setLinkDraft(e.target.value);
                setLinkError(null);
              }}
              // Enter inside the field would otherwise submit the whole
              // form with the link still uncommitted.
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={disabled || isPending || linkDraft.trim() === ""}
              onClick={addLink}
            >
              Add
            </Button>
          </div>
          {linkError && <p className="text-xs text-unsold">{linkError}</p>}

          {links.length > 0 && (
            <ul className="space-y-1.5">
              {links.map((url) => (
                <li
                  key={url}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <LinkIcon className="size-4 shrink-0 text-ink-2" />
                    <span className="truncate">{url}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0"
                    disabled={disabled || isPending}
                    onClick={() => setLinks(links.filter((u) => u !== url))}
                    aria-label={`Remove ${url}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
      <Button
        type="submit"
        disabled={disabled || isPending || (files.length === 0 && links.length === 0)}
      >
        {isPending ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
