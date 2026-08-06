import { cn } from "@/lib/utils";

/**
 * Every status word used across the product, mapped to one visual tone.
 * Deliberately one shared vocabulary/component rather than one-off badges
 * per feature — TECH-03 (reusable components, no round-specific
 * duplication) and the §8.1 status language the classroom dashboard must
 * use verbatim.
 */
export const STATUS_TONES = {
  // §8.1 round/task status language
  upcoming: "neutral",
  "open-eligible": "gold",
  "open-view-only": "neutral",
  submitted: "success",
  closed: "neutral",
  scored: "analytics",
  qualified: "success",
  eliminated: "danger",
  // Auction player / sale state (§21.3)
  available: "neutral",
  active: "live",
  sold: "success",
  unsold: "danger",
  recalled: "gold",
  // Analytics state (§21.4)
  locked: "neutral",
  requested: "gold",
  purchased: "analytics",
  rejected: "danger",
} as const;

export type StatusKey = keyof typeof STATUS_TONES;
type Tone = (typeof STATUS_TONES)[StatusKey];

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2 border-transparent",
  gold: "bg-gold/15 text-gold border-gold/30",
  success: "bg-sold/15 text-sold border-sold/30",
  danger: "bg-unsold/15 text-unsold border-unsold/30",
  live: "bg-live/15 text-live border-live/30 animate-pulse",
  analytics: "bg-analytics/15 text-analytics border-analytics/30",
};

const DEFAULT_LABELS: Record<StatusKey, string> = {
  upcoming: "Upcoming",
  "open-eligible": "Open",
  "open-view-only": "Open · View only",
  submitted: "Submitted",
  closed: "Closed",
  scored: "Scored",
  qualified: "Qualified",
  eliminated: "Eliminated",
  available: "Available",
  active: "Active",
  sold: "Sold",
  unsold: "Unsold",
  recalled: "Recalled",
  locked: "Locked",
  requested: "Requested",
  purchased: "Purchased",
  rejected: "Rejected",
};

export function StatusPill({
  status,
  label,
  className,
}: {
  status: StatusKey;
  /** Override the default copy — e.g. include a countdown or a reason. */
  label?: string;
  className?: string;
}) {
  const tone = STATUS_TONES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-heading text-xs font-semibold uppercase tracking-wide",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {tone === "live" && (
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
      )}
      {label ?? DEFAULT_LABELS[status]}
    </span>
  );
}
