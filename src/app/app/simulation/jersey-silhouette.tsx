"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Plan spec: "jersey-number-7 player silhouette that turns green on
 * success / red on failure with a pulsing glow". Hand-drawn inline SVG —
 * no illustration asset exists for this, and the brand system forbids IPL
 * artwork (CLAUDE.md), so this is an original shape, not a licensed one.
 */
export function JerseySilhouette({ tone }: { tone: "standby" | "success" | "failure" }) {
  const reduceMotion = useReducedMotion();
  const strokeClass = tone === "success" ? "stroke-sold" : tone === "failure" ? "stroke-unsold" : "stroke-border";
  const fillClass = tone === "success" ? "fill-sold/15" : tone === "failure" ? "fill-unsold/15" : "fill-card";

  const glow = (
    <motion.g
      animate={reduceMotion ? undefined : { opacity: [0.5, 1, 0.5] }}
      transition={reduceMotion ? undefined : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      style={{ filter: tone === "standby" ? undefined : "drop-shadow(0 0 10px currentColor)" }}
      className={strokeClass}
    >
      {/* Torso + sleeves + collar — a generic sporting jersey shape, not any
          real team's kit. */}
      <path
        d="M35 20 L45 12 L55 12 L65 20 L80 28 L74 42 L65 36 L65 88 L35 88 L35 36 L26 42 L20 28 Z"
        fill="none"
        strokeWidth={2.5}
        className={fillClass}
      />
      <path d="M45 12 Q50 22 55 12" fill="none" strokeWidth={2} />
    </motion.g>
  );

  return (
    <svg viewBox="0 0 100 100" width={96} height={96} aria-hidden="true" className={strokeClass}>
      {glow}
      <text x={50} y={62} textAnchor="middle" className="fill-current font-display text-[32px] font-bold">
        7
      </text>
    </svg>
  );
}
