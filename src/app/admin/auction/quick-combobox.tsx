"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * A type-to-filter, Enter-to-pick field for the auction admin surfaces — the
 * console's player and franchise pickers, and the trade block's.
 *
 * Deliberately *not* a shadcn Select. In the low-value pools a lot clears
 * roughly every 40 seconds, and a Select costs a click to open, a scan of a
 * scrolling list and a second click to choose — three pointer round-trips per
 * field, twice per sale. This takes one: type a few letters, Enter. The mouse
 * still works (focus opens the full list, click picks) so nothing is lost for
 * an admin who prefers it.
 *
 * Not built on Base UI's Combobox on purpose: the console needs to *keep*
 * driving focus after a pick (player -> team -> amount -> back to player), and
 * owning the input element outright is what makes `onPicked` able to hand focus
 * onward synchronously. It is also why the popup here is a plain absolutely
 * positioned list rather than a portalled popup — no outside-press machinery
 * means no `isPopupCloseArtifact` hazard (see src/lib/utils.ts) if this ever
 * ends up inside a Dialog.
 */
export type QuickComboboxItem = {
  /** Value handed back to `onSelect`. */
  id: string;
  /** Primary line, and the text matched against. */
  label: string;
  /** Extra searchable text (pool, role, registered name) — not the match target for ranking. */
  keywords?: string;
  /** Right-aligned secondary line (price, purse). */
  meta?: React.ReactNode;
  /** Tooltip on `meta` — the exact figure behind a rounded crore display. */
  metaTitle?: string;
  /** Muted line under the label. */
  detail?: React.ReactNode;
};

/** Word-boundary aware scoring: "mumb" beats a mid-word hit elsewhere. */
function score(item: QuickComboboxItem, query: string): number {
  const q = query.toLowerCase();
  const label = item.label.toLowerCase();
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  // Any word in the label starting with the query — "rah" finds "KL RAHUL".
  if (label.split(/[\s.'’-]+/).some((w) => w.startsWith(q))) return 2;
  if (label.includes(q)) return 3;
  const keywords = (item.keywords ?? "").toLowerCase();
  if (keywords.includes(q)) return 4;
  // Initials: "kr" finds "KL RAHUL".
  const initials = label
    .split(/[\s.'’-]+/)
    .map((w) => w[0] ?? "")
    .join("");
  if (initials.startsWith(q)) return 2;
  return Number.POSITIVE_INFINITY;
}

export function QuickCombobox({
  items,
  placeholder,
  onSelect,
  inputRef,
  disabled,
  id,
  maxResults = 8,
  className,
  emptyLabel = "No match",
}: {
  items: QuickComboboxItem[];
  placeholder: string;
  /** Called with the chosen item. The field clears itself and blurs the popup. */
  onSelect: (item: QuickComboboxItem) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  id?: string;
  maxResults?: number;
  className?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const listId = useId();

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, maxResults);
    return items
      .map((item) => ({ item, s: score(item, q) }))
      .filter((r) => Number.isFinite(r.s))
      .sort((a, b) => a.s - b.s || a.item.label.localeCompare(b.item.label))
      .slice(0, maxResults)
      .map((r) => r.item);
  }, [items, query, maxResults]);

  function pick(item: QuickComboboxItem | undefined) {
    if (!item) return;
    setQuery("");
    setOpen(false);
    onSelect(item);
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        ref={ref}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          // Reset the highlight here rather than in an effect on `query`: the
          // result list shrinks as the query narrows, and a cursor left past
          // the new end would make Enter pick nothing.
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        // A timeout-free blur close would fire before a click on a result
        // registers, so the click would land on an already-unmounted row.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setCursor((c) => Math.min(c + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter") {
            // Always swallow Enter: this field lives inside the sale <form>,
            // and letting it bubble would submit a half-filled sale.
            e.preventDefault();
            if (open && results.length > 0) pick(results[cursor]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (query) setQuery("");
            else setOpen(false);
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-72 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink-3">{emptyLabel}</li>
          )}
          {results.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                // mousedown, not click: the input's blur handler runs first on
                // click and would have closed the list already.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
                onMouseEnter={() => setCursor(i)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm",
                  i === cursor ? "bg-gold/15 text-ink-1" : "text-ink-2",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {item.label}
                  </span>
                  {item.detail && (
                    <span className="block truncate text-xs text-ink-3">
                      {item.detail}
                    </span>
                  )}
                </span>
                {item.meta && (
                  <span
                    title={item.metaTitle}
                    className="shrink-0 font-mono text-xs tabular-nums"
                  >
                    {item.meta}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
