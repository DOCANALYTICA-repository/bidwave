"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { UploadCloud, File as FileIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Controlled drag-and-drop / click file picker for round submissions
 * (§9.1: multiple PDF/PPTX/DOCX/XLSX or video files, freely replaceable
 * until close) and
 * the registration invoice upload (REG-07: PDF/JPG/PNG). The app has no
 * application-level size limit (§9.1) — `maxSizeBytes` here is only the
 * infrastructure ceiling surfaced honestly up front (ERR-02), not a rule
 * this component enforces silently.
 */
export function FileDrop({
  value,
  onChange,
  accept,
  multiple = true,
  maxSizeBytes,
  onOversize,
  disabled,
  className,
}: {
  value: File[];
  onChange: (files: File[]) => void;
  /** e.g. ".pdf,.pptx,.docx,.xlsx" */
  accept?: string;
  multiple?: boolean;
  maxSizeBytes?: number;
  /**
   * Called with the files that were turned away for being over
   * `maxSizeBytes`. Lets a caller offer the way around the limit (round
   * submissions answer with the shared-link field) instead of leaving the
   * team with a dead end. When set, the caller owns the messaging and this
   * component renders none.
   */
  onOversize?: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [oversizeError, setOversizeError] = useState<string | null>(null);
  // Before hydration completes, the server-rendered <label>/<input> are
  // already real, clickable DOM — a click opens the native file picker,
  // but the resulting `change` event fires before React has attached its
  // delegated onChange listener, so the selection is silently lost
  // (browsers never replay a past event for a listener added afterward).
  // Disabling the input until mounted closes that window; this is a
  // hydration-safety gate, not a real disabled state, so it deliberately
  // does not affect the server-rendered markup's appearance.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming || disabled || !mounted) return;
      const next = Array.from(incoming);
      const oversized = maxSizeBytes
        ? next.filter((f) => f.size > maxSizeBytes)
        : [];
      if (oversized.length > 0) {
        onOversize?.(oversized);
        setOversizeError(
          onOversize
            ? null
            : `${oversized.map((f) => f.name).join(", ")} exceed${
                oversized.length === 1 ? "s" : ""
              } the ${formatBytes(maxSizeBytes!)} upload limit.`,
        );
      } else {
        setOversizeError(null);
      }
      const accepted = next.filter((f) => !oversized.includes(f));
      onChange(multiple ? [...value, ...accepted] : accepted.slice(0, 1));
    },
    [disabled, mounted, maxSizeBytes, multiple, onChange, onOversize, value],
  );

  return (
    <div className={cn("space-y-2", className)}>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          isDragging
            ? "border-gold bg-gold/5"
            : "border-border bg-surface-1 hover:border-gold/40",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <UploadCloud className="size-6 text-ink-2" />
        <p className="text-sm font-medium text-foreground">
          Drop files here, or click to browse
        </p>
        {accept && (
          <p className="text-xs text-ink-3">Accepted: {accept.replaceAll(".", "").toUpperCase()}</p>
        )}
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled || !mounted}
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {oversizeError && <p className="text-xs text-unsold">{oversizeError}</p>}

      {value.length > 0 && (
        <ul className="space-y-1.5">
          {value.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileIcon className="size-4 shrink-0 text-ink-2" />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-ink-3">
                  {formatBytes(file.size)}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                disabled={disabled}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={`Remove ${file.name}`}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
