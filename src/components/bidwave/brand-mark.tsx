import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The four brand marks Bidwave must display, all pre-processed into
 * transparent PNGs in public/brand (see reference/ for raw originals and
 * docs/DESIGN_SYSTEM.md for how they were extracted). Every mark here is
 * light-on-dark — this product is dark-only, so that's the only polarity
 * that exists in the design system.
 */
// Aspect ratios match each file's actual cropped content bounding box
// (see docs/DESIGN_SYSTEM.md) — keep these in sync if an asset is replaced.
const MARKS = {
  bidwave: {
    src: "/brand/bidwave-mark.png",
    alt: "Bidwave — The Pulse of IPL Auction",
    aspect: 325 / 252,
  },
  "christ-university": {
    src: "/brand/christ-university-mark.png",
    alt: "CHRIST (Deemed to be University)",
    aspect: 320 / 120,
  },
  "doc-commerce": {
    src: "/brand/doc-commerce-mark.png",
    alt: "Department of Commerce",
    aspect: 376 / 162,
  },
  "doc-analytica": {
    src: "/brand/doc-analytica-logo.png",
    alt: "DOC Analytica",
    aspect: 452 / 575,
  },
} as const;

export type BrandMarkName = keyof typeof MARKS;

export function BrandMark({
  name,
  height = 32,
  className,
  priority,
}: {
  name: BrandMarkName;
  /** Rendered height in px; width is derived from the mark's own aspect ratio. */
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  const mark = MARKS[name];
  const width = Math.round(height * mark.aspect);

  return (
    <Image
      src={mark.src}
      alt={mark.alt}
      width={width}
      height={height}
      priority={priority}
      className={cn("h-auto w-auto object-contain", className)}
      style={{ height, width }}
    />
  );
}
