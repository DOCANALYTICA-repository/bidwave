import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A labeled number/value for dashboards and broadcast panels — rank,
 * remaining purse, squad size, time remaining. One shared shape so
 * scoreboard-style surfaces stay visually consistent (§24.2).
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "gold" | "danger" | "success";
  className?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    gold: "text-gold",
    danger: "text-unsold",
    success: "text-sold",
  }[tone];

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-ink-2">
        {icon}
        <span className="font-heading text-xs font-semibold uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className={cn("font-mono text-2xl font-bold tabular-nums", toneClass)}>
        {value}
      </div>
      {hint && <div className="text-xs text-ink-3">{hint}</div>}
    </div>
  );
}
