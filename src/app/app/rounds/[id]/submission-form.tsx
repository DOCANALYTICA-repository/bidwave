"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
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

type Uploaded = { path: string; name: string; type: string };
type Progress = { done: number; total: number; name: string; fraction: number };

/**
 * Identity for the already-uploaded cache. Not the name alone: a team that
 * swaps in a re-exported file of the same name must re-upload it.
 */
function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function SubmissionForm({ roundId, disabled }: { roundId: string; disabled: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [state, formAction, isSubmitting] = useActionState(submitRoundFiles, initialState);
  // Files go browser → Storage before the action runs, so "busy" has to
  // cover the upload too (see lib/uploads/direct-upload.ts). A plain flag,
  // not useTransition — the upload must be awaited outside any transition.
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const isPending = isSubmitting || isUploading;

  /**
   * Objects already written to Storage this session, so a failure on file
   * 5 of 5 doesn't make a team re-send the four that landed — on a phone
   * that was the difference between a retry costing seconds and costing
   * another ten minutes against a deadline.
   *
   * Only safe while the *upload* leg is what failed. Once the Server
   * Action runs and rejects, it deletes the objects it was given
   * (removeUploadedObjects), so these paths are dead and the cache is
   * dropped — see the effect below.
   */
  const uploadedRef = useRef(new Map<string, Uploaded>());

  // Shared links, for files over the upload cap and as a fallback whenever
  // an upload won't go through. Always offered: a team on a weak line
  // needs this route without first having to fail an upload to discover
  // it.
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  // Set when the picker turns a file away for being too big — this is what
  // turns the limit from a dead end into an instruction.
  const [oversizeNotice, setOversizeNotice] = useState<string | null>(null);

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
    if (state.status === "idle") return;
    // The action deletes the uploaded objects on any rejection, so their
    // paths must not be reused on the next attempt.
    uploadedRef.current = new Map();
    if (state.status !== "success") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setFiles([]);
    setLinks([]);
    setLinkDraft("");
    setOversizeNotice(null);
    setProgress(null);
  }, [state]);

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
        setProgress(null);
        setUploadError(message);
        toast.error(message);
      };

      // Only what isn't already in Storage from an earlier attempt. A
      // links-only submission skips this leg entirely rather than minting
      // targets for an empty list.
      const pending = files.filter((f) => !uploadedRef.current.has(fileKey(f)));
      const carried = files.length - pending.length;

      if (pending.length > 0) {
        const result = await createSubmissionUploadTargets(
          roundId,
          pending.map((f) => ({ name: f.name, type: f.type, size: f.size })),
        );
        if ("error" in result) return fail(result.error);

        for (const [index, target] of result.targets.entries()) {
          const file = pending[index]!;
          setProgress({
            done: carried + index,
            total: files.length,
            name: file.name,
            fraction: 0,
          });
          const failure = await uploadToTarget(target, file, (fraction) =>
            setProgress((current) => (current ? { ...current, fraction } : current)),
          );
          if (failure) return fail(`"${file.name}": ${failure}`);
          uploadedRef.current.set(fileKey(file), {
            path: target.path,
            name: file.name,
            type: file.type,
          });
        }
      }

      const uploaded = files
        .map((f) => uploadedRef.current.get(fileKey(f)))
        .filter((entry): entry is Uploaded => entry !== undefined);

      const fd = new FormData();
      fd.set("roundId", roundId);
      fd.set("files", JSON.stringify(uploaded));
      fd.set("links", JSON.stringify(links.map((url) => ({ url, label: "" }))));

      // Synchronous dispatch inside a fresh transition — calling
      // formAction after an `await` runs the action "outside of a
      // transition", which leaves isPending stuck and drops the reply.
      setIsUploading(false);
      setProgress(null);
      startTransition(() => formAction(fd));
    })();
  }

  const percent = progress ? Math.round(progress.fraction * 100) : 0;

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

      {/* A live byte counter, not a spinner: a 50MB video takes minutes on
          a phone, and without this a working upload and a hung one look
          identical. */}
      {progress && (
        <div
          className="space-y-1.5 rounded-lg border border-border bg-surface-1 px-3 py-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-foreground">
              Uploading {progress.done + 1} of {progress.total} — {progress.name}
            </span>
            <span className="shrink-0 tabular-nums text-ink-2">{percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-gold transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-ink-3">
            Large videos can take several minutes. Keep this tab open — it will retry on its own if
            the connection drops.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="submission-link" className="block text-sm font-medium text-foreground">
          Sharing link{" "}
          <span className="font-normal text-ink-3">
            — for anything over 50MB, or if an upload won&apos;t go through
          </span>
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
        {!linkError && links.length === 0 && (
          <p className="text-xs text-ink-3">
            In Drive: Share → General access → Anyone with the link (Viewer), then Copy link. Add it
            here and press Submit.
          </p>
        )}

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

      {(uploadError || (state.status === "error" && state.formError)) && (
        <div className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
          <p>{uploadError ?? state.formError}</p>
          {uploadError && (
            <p className="mt-1 text-ink-2">
              Press Submit to retry — files that already went up are kept, so only the rest are
              re-sent. If it keeps failing, put the file on Google Drive and paste the sharing link
              above.
            </p>
          )}
        </div>
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
        {isUploading ? "Uploading…" : isSubmitting ? "Saving…" : "Submit"}
      </Button>
    </form>
  );
}
