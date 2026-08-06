"use client";

import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import {
  acquireRecordLock,
  heartbeatRecordLock,
  releaseRecordLock,
} from "@/app/admin/auction/console/actions";

/**
 * AUC-14/15: advisory-only — warns when another device has this record
 * open. Does NOT gate the sale/reversal RPCs themselves (see
 * record_locks' table comment); a crashed tab that never releases its
 * lock must never block a legitimate sale.
 */
export function ConsoleLockBadge({
  recordType,
  recordId,
  deviceLabel,
}: {
  recordType: "player" | "sale";
  recordId: string;
  deviceLabel: string;
}) {
  const [lockedElsewhere, setLockedElsewhere] = useState<{ device_label?: string } | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let heartbeatId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      const result = await acquireRecordLock(recordType, recordId, deviceLabel);
      if (cancelled) return;

      if (result.error === "record_locked") {
        setLockedElsewhere((result.detail as { device_label?: string } | null) ?? {});
        return;
      }

      if (result.sessionToken) {
        sessionTokenRef.current = result.sessionToken;
        heartbeatId = setInterval(() => {
          if (sessionTokenRef.current) {
            heartbeatRecordLock(recordType, recordId, sessionTokenRef.current);
          }
        }, 8000);
      }
    })();

    return () => {
      cancelled = true;
      if (heartbeatId) clearInterval(heartbeatId);
      if (sessionTokenRef.current) {
        releaseRecordLock(recordType, recordId, sessionTokenRef.current);
      }
    };
  }, [recordType, recordId, deviceLabel]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden" && sessionTokenRef.current) {
        releaseRecordLock(recordType, recordId, sessionTokenRef.current);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [recordType, recordId]);

  if (!lockedElsewhere) return null;

  return (
    <span className="flex items-center gap-1.5 rounded-full border border-live/30 bg-live/15 px-2.5 py-0.5 text-xs font-semibold text-live">
      <Lock className="size-3" />
      Being edited on {lockedElsewhere.device_label ?? "another device"}
    </span>
  );
}
