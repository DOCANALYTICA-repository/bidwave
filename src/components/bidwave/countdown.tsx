"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Ticks toward (or since) a server-issued deadline. Never trust the
 * browser's own clock as authoritative (SEC-06, QZ-16, SIM-08) — callers
 * must pass `serverNowAtMount`, the server's `now()` at the moment this
 * component received its data (e.g. from a Server Component render or an
 * RPC response). The offset between that and the browser's clock is
 * computed once and applied to every subsequent tick, so a wrong local
 * clock never lets a countdown run fast or slow relative to the server —
 * the display is cosmetic; deadline enforcement always happens server-side.
 */
export function Countdown({
  target,
  serverNowAtMount,
  onExpire,
  className,
  expiredLabel = "Closed",
}: {
  target: string | Date;
  serverNowAtMount: string | Date;
  onExpire?: () => void;
  className?: string;
  expiredLabel?: string;
}) {
  // Parsing a fixed string is pure; Date.now() is not — it only ever runs
  // inside the effect below, never during render (react-hooks/purity).
  const targetMs = new Date(target).getTime();

  // null until the mount effect computes the first tick, so server and
  // client render the same placeholder and there's nothing to hydrate
  // against a clock that hasn't run yet.
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    const clockOffsetMs = new Date(serverNowAtMount).getTime() - Date.now();

    // setState only ever happens inside the interval callback here, never
    // synchronously in the effect body (react-hooks/set-state-in-effect) —
    // the tradeoff is up to one 250ms tick showing the "—:—" placeholder
    // before the first real value, which is imperceptible for a countdown.
    const id = setInterval(() => {
      const next = targetMs - (Date.now() + clockOffsetMs);
      setRemainingMs(next);
      // Stop ticking once expired — otherwise this would run forever,
      // producing an ever-more-negative value every 250ms and re-firing
      // the onExpire effect below on every single tick.
      if (next <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [targetMs, serverNowAtMount]);

  // remainingMs only changes again after expiry if it hadn't already
  // reached <= 0 (see above), so this fires exactly once per expiry.
  useEffect(() => {
    if (remainingMs !== null && remainingMs <= 0) onExpire?.();
  }, [remainingMs, onExpire]);

  if (remainingMs === null || remainingMs <= 0) {
    return (
      <span className={cn("font-mono tabular-nums", className)}>
        {remainingMs === null ? "—:—" : expiredLabel}
      </span>
    );
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <span
      className={cn("font-mono tabular-nums", className)}
      aria-live="off"
    >
      {h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`}
    </span>
  );
}
