import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/bidwave/brand-mark";

const SIZES = {
  sm: { text: "text-xs", height: 24, gap: "gap-2" },
  md: { text: "text-sm", height: 32, gap: "gap-2.5" },
  lg: { text: "text-base", height: 40, gap: "gap-3" },
} as const;

export type PoweredByCreditSize = keyof typeof SIZES;

/**
 * Single source of truth for the mandatory DOC Analytica credit line —
 * previously hand-copied (and worded inconsistently) in 3+ places.
 */
export function PoweredByCredit({
  size = "md",
  className,
}: {
  size?: PoweredByCreditSize;
  className?: string;
}) {
  const { text, height, gap } = SIZES[size];
  return (
    <span className={cn("flex items-center", gap, text, "text-ink-2", className)}>
      Powered by
      <BrandMark name="doc-analytica" height={height} />
    </span>
  );
}
