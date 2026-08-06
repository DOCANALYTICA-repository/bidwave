import { cn } from "@/lib/utils";

/**
 * Single-hue magnitude meter — the --analytics accent fills a track,
 * proportional to value/max. One hue for one measure (never a rainbow),
 * direct label instead of a legend since each bar names its own category.
 * Plain divs, no chart library, matching this product's hand-rolled kit.
 */
export function MeterBar({
  label,
  value,
  max,
  detail,
  tone = "analytics",
}: {
  label: string;
  value: number;
  max: number;
  detail?: string;
  tone?: "analytics" | "danger";
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-2">{label}</span>
        <span className="font-mono text-xs text-ink-3">
          {value}
          {max > 0 ? ` / ${max}` : ""}
          {detail ? ` · ${detail}` : ""}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn("h-full rounded-full", tone === "danger" ? "bg-unsold" : "bg-analytics")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
