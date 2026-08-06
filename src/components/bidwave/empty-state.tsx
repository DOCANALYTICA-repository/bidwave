import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Standard empty/zero-data state — "no rounds released yet", "no
 * submissions", "no sales recorded". §24.4 requires robust empty states
 * as a first-class design concern, not an afterthought.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      {icon && <div className="text-ink-3">{icon}</div>}
      <div className="space-y-1">
        <p className="font-heading text-sm font-semibold text-foreground">
          {title}
        </p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-ink-2">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
