"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { WifiOff, RefreshCw, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConnectionStatus = "online" | "reconnecting" | "offline";

/**
 * Fixed banner for connection loss / Realtime channel drops (ERR-08,
 * NFR-05). Purely presentational — the caller (a Realtime subscription
 * hook, the quiz runner's heartbeat, etc.) owns the actual status and
 * fallback-refetch logic; this only makes that state visible so a user is
 * never silently looking at stale data.
 */
export function ReconnectBanner({ status }: { status: ConnectionStatus }) {
  const prefersReducedMotion = useReducedMotion();
  const [prevStatus, setPrevStatus] = useState(status);
  const [showBackOnline, setShowBackOnline] = useState(false);

  // Derive "just came back online" directly during render (React's
  // recommended pattern for syncing state to a prop change) rather than in
  // an effect — the effect below only ever owns the auto-hide timer.
  if (status !== prevStatus) {
    setPrevStatus(status);
    setShowBackOnline(status === "online" && prevStatus !== "online");
  }

  useEffect(() => {
    if (!showBackOnline) return;
    const id = setTimeout(() => setShowBackOnline(false), 2500);
    return () => clearTimeout(id);
  }, [showBackOnline]);

  const visible = status !== "online" || showBackOnline;
  const config = {
    offline: {
      icon: <WifiOff className="size-4" />,
      text: "Connection lost — trying to reconnect…",
      tone: "bg-unsold/15 text-unsold border-unsold/30",
    },
    reconnecting: {
      icon: <RefreshCw className="size-4 animate-spin" />,
      text: "Reconnecting…",
      tone: "bg-live/15 text-live border-live/30",
    },
    online: {
      icon: <Wifi className="size-4" />,
      text: "Back online — showing the latest data.",
      tone: "bg-sold/15 text-sold border-sold/30",
    },
  }[status === "online" && showBackOnline ? "online" : status];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={prefersReducedMotion ? { opacity: 0 } : { y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { y: -48, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn(
            "fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 border-b px-4 py-2 text-sm font-medium",
            config.tone,
          )}
        >
          {config.icon}
          {config.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Baseline browser online/offline detection, for callers with no Realtime channel of their own. */
export function useBrowserConnectionStatus(): ConnectionStatus {
  // Lazy initializer, not an effect — avoids a synchronous setState in the
  // mount effect (react-hooks/set-state-in-effect). Guarded for SSR, where
  // `navigator` doesn't exist; the "online" default is corrected on mount
  // by the listeners below if it was actually wrong.
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online",
  );

  useEffect(() => {
    const goOnline = () => setStatus("online");
    const goOffline = () => setStatus("offline");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return status;
}
