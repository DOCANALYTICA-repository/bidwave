"use client";

import { useId, useState } from "react";

/**
 * Single-series change-over-time line. Hand-rolled SVG, no chart library —
 * same reasoning as meter-bar.tsx and radial-score.tsx.
 *
 * One series, so there is deliberately no legend (the section heading names
 * the measure) and no categorical palette: a lone sequential hue carries
 * magnitude. 2px stroke, recessive baseline, and a hover crosshair with a
 * tooltip rather than a number printed on every point.
 *
 * Values are plotted in the order given; `labels` (same length) supply the
 * tooltip's x-axis text. The y-scale always includes 0 so bar-like growth is
 * not exaggerated by a floating baseline.
 */
const inrCompact = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/**
 * `format` is a string, not a formatter function: this is a client component
 * and every caller is a server component, so a function prop would throw
 * "Functions cannot be passed directly to Client Components" at render time.
 * Verified by direct reproduction — neither tsc nor next build catches it.
 */
function formatFor(format: SparklineFormat, value: number): string {
  if (format === "crore") return `₹${inrCompact.format(value / 10_000_000)} Cr`;
  return inrCompact.format(value);
}

export type SparklineFormat = "crore" | "number";

export function Sparkline({
  values,
  labels,
  format = "number",
  height = 64,
  tone = "gold",
  ariaLabel,
}: {
  values: number[];
  labels?: string[];
  format?: SparklineFormat;
  height?: number;
  tone?: "gold" | "analytics";
  ariaLabel: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (values.length === 0) return null;

  const W = 100;
  const H = 100;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  // A single point has no line to draw; centre it so the dot is still visible.
  const x = (i: number) => (values.length === 1 ? W / 2 : (i / (values.length - 1)) * W);
  const y = (v: number) => H - ((v - min) / span) * H;

  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const stroke = tone === "analytics" ? "var(--analytics)" : "var(--gold)";
  const active = hover != null ? values[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height, width: "100%" }}
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        <polygon points={`0,${H} ${points} ${W},${H}`} fill={`url(#${gradientId})`} />
        <polyline
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {hover != null && (
          <line
            x1={x(hover)}
            y1="0"
            x2={x(hover)}
            y2={H}
            stroke="var(--ink-3)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hover != null && (
          <circle cx={x(hover)} cy={y(values[hover])} r="2.5" fill={stroke} vectorEffect="non-scaling-stroke" />
        )}

        {/* Invisible hit bands, wider than the marks, so hovering is easy. */}
        {values.map((_, i) => (
          <rect
            key={i}
            x={i === 0 ? 0 : x(i) - W / (values.length - 1 || 1) / 2}
            y="0"
            width={W / (values.length - 1 || 1)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {hover != null && active != null && (
        <div className="pointer-events-none absolute -top-1 left-0 w-full text-center">
          <span className="rounded bg-surface-4 px-2 py-0.5 font-mono text-[11px] text-foreground shadow-sm">
            {labels?.[hover] ? `${labels[hover]} · ` : ""}
            {formatFor(format, active)}
          </span>
        </div>
      )}
    </div>
  );
}
