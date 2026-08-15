"use client";

import { useEffect, useState } from "react";

/**
 * Display-only countdown to the preview session's expiry (architecture
 * principle #1: client clocks never decide anything). The server remains the
 * sole authority on whether the token is still valid — this just tells the
 * admin roughly how long is left before preview drops out from under them.
 *
 * Deliberately renders nothing until after mount. Deriving text from
 * Date.now() during SSR guarantees a hydration mismatch: the server's "1h 59m"
 * has already become "1h 58m" by the time the client hydrates, and React
 * compares those as text nodes. Confirmed by reproduction — the first version
 * of this component threw "Hydration failed because the server rendered text
 * that didn't match" on every page load in preview.
 */
export function PreviewCountdown({ expiresAt }: { expiresAt: number }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(expiresAt - Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remaining === null) return null;
  if (remaining <= 0) return <span>{"· expired — reload to leave preview"}</span>;

  const minutes = Math.floor(remaining / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return <span>{`· expires in ${hours}h ${minutes % 60}m`}</span>;
  }
  if (minutes >= 1) return <span>{`· expires in ${minutes}m`}</span>;
  return <span>{`· expires in ${remaining}s`}</span>;
}
