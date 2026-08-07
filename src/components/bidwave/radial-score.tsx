"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useTransform, useMotionValueEvent, animate } from "motion/react";

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Hand-rolled (no chart library in this repo, see meter-bar.tsx) SVG
 * radial gauge for the simulation result panel — a "Team Balance Score"
 * `lg` dial plus six labelled `sm` sub-score dials (plan spec, see
 * .claude/plans/this-project-is-exclusively-starry-shore.md).
 *
 * `animate` must be false for a server-rendered initial result (history[0])
 * — animating the very first paint would diverge from the server-rendered
 * tree mid-flight for no reason, and a stale historical result animating
 * "up from 0" on every reload would misrepresent it as fresh.
 */
export function RadialScore({
  label,
  value,
  size = "sm",
  tone = "gold",
  animate: shouldAnimate,
  delay = 0,
}: {
  label: string;
  value: number;
  size?: "lg" | "sm";
  tone?: "gold" | "success" | "danger";
  animate: boolean;
  delay?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const progress = useMotionValue(shouldAnimate ? 0 : clamped);
  const dashoffset = useTransform(progress, (v) => CIRCUMFERENCE * (1 - v / 100));
  // SVG <text> doesn't support the HTML-only convenience of rendering a
  // MotionValue directly as React children (confirmed by direct
  // reproduction — the DOM text node never updated), so the center number
  // is tracked in real state instead, driven off the same motion value the
  // stroke animation uses.
  const [display, setDisplay] = useState(Math.round(shouldAnimate ? 0 : clamped));
  useMotionValueEvent(progress, "change", (v) => setDisplay(Math.round(v)));

  useEffect(() => {
    if (!shouldAnimate) {
      progress.set(clamped);
      return;
    }
    const controls = animate(progress, clamped, { duration: 0.9, ease: "easeOut", delay });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clamped, shouldAnimate, delay]);

  const dim = size === "lg" ? 128 : 76;
  const strokeWidth = size === "lg" ? 7 : 5;
  const toneClass = tone === "success" ? "stroke-sold" : tone === "danger" ? "stroke-unsold" : "stroke-gold";

  return (
    <div className="flex flex-col items-center gap-1.5" role="img" aria-label={`${label}: ${clamped}`}>
      <svg width={dim} height={dim} viewBox="0 0 100 100" className="-rotate-90">
        <circle cx={50} cy={50} r={RADIUS} fill="none" strokeWidth={strokeWidth} className="stroke-border" />
        <motion.circle
          cx={50}
          cy={50}
          r={RADIUS}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          style={{ strokeDashoffset: dashoffset }}
          className={toneClass}
        />
        <text
          x={50}
          y={50}
          textAnchor="middle"
          dominantBaseline="central"
          transform="rotate(90 50 50)"
          className={`fill-current font-mono font-bold tabular-nums ${size === "lg" ? "text-[22px]" : "text-[15px]"}`}
        >
          {display}
        </text>
      </svg>
      <p className="font-heading text-[10px] font-semibold uppercase tracking-wide text-ink-2">{label}</p>
    </div>
  );
}
