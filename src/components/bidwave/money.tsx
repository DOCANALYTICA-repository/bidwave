"use client";

import { motion, useReducedMotion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/**
 * Formats an auction purse/price with Indian digit grouping (lakh/crore) in
 * tabular numerals, so a column of amounts lines up. Never trust this
 * component's input as authoritative — it only renders whatever the server
 * already computed (architecture principle #1); nothing here does purse
 * arithmetic.
 */
export function Money({
  value,
  className,
  /** Pulses gold briefly when `value` changes — use for live purse/sale updates (UX-04). */
  animateChange = false,
}: {
  value: number;
  className?: string;
  animateChange?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const formatted = inr.format(value);

  if (!animateChange || prefersReducedMotion) {
    return (
      <span className={cn("font-mono tabular-nums", className)}>
        {formatted}
      </span>
    );
  }

  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={value}
        initial={{ color: "var(--gold-bright)", scale: 1.04 }}
        animate={{ color: "var(--foreground)", scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className={cn("inline-block font-mono tabular-nums", className)}
      >
        {formatted}
      </motion.span>
    </AnimatePresence>
  );
}

/** A "+₹5,000" / "-₹1,200" chip for showing the delta of a single transaction. */
export function MoneyDelta({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const isPositive = value >= 0;
  return (
    <span
      className={cn(
        "font-mono text-sm font-semibold tabular-nums",
        isPositive ? "text-sold" : "text-unsold",
        className,
      )}
    >
      {isPositive ? "+" : "−"}
      {inr.format(Math.abs(value))}
    </span>
  );
}
