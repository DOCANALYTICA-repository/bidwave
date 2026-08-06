"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ConnectionStatus } from "@/components/bidwave";
import { useState } from "react";

/**
 * Subscribes to INSERT events on live_broadcast for one topic and calls
 * onEvent — every consumer does a full refetch of its own relevant slice,
 * never incremental patching from the payload (principle #5, generalized:
 * "clients refetch ... after a topic ping" applies to any endpoint here,
 * since none of this phase's public data is actually private). Fires once
 * on mount/reconnect (the reconnect-and-refetch fallback) plus a 15s
 * reconciliation poll as a belt-and-suspenders backstop — mirrors
 * principle #3's "never solely trust the tick" applied to realtime instead
 * of cron.
 */
export function useLiveBroadcast(
  eventEditionId: string | null,
  topic: string,
  onEvent: () => void,
): { status: ConnectionStatus } {
  const [status, setStatus] = useState<ConnectionStatus>("online");
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!eventEditionId) return;
    const supabase = createClient();
    const channelName = `live_broadcast:${topic}:${eventEditionId}`;

    // `createClient()` returns a shared singleton under the hood (`@supabase
    // /ssr`'s `createBrowserClient` memoizes one real client per browser tab
    // to avoid duplicate GoTrueClient instances), so this channel's realtime
    // socket and channel registry are shared across every mount of every
    // component using this hook. A fast unmount+remount — e.g. a browser
    // back-button press racing this effect's own async `removeChannel`
    // cleanup below — can otherwise leave a channel of the same name still
    // registered when the next mount calls `.channel()` again: supabase-js
    // returns that *existing* (already-subscribed) channel object instead of
    // a fresh one, and calling `.on()` on an already-subscribed channel
    // throws "cannot add postgres_changes callbacks ... after subscribe()".
    // Reproduced directly via rapid browser back/forward on /admin/teams.
    // Removing any stale same-name channel synchronously first guarantees a
    // genuinely fresh registration every time.
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_broadcast",
          filter: `event_edition_id=eq.${eventEditionId}`,
        },
        () => onEventRef.current(),
      )
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
          setStatus("online");
          onEventRef.current();
        } else if (subscribeStatus === "CHANNEL_ERROR" || subscribeStatus === "TIMED_OUT") {
          setStatus("reconnecting");
        } else if (subscribeStatus === "CLOSED") {
          setStatus("offline");
        }
      });

    const pollId = setInterval(() => onEventRef.current(), 15000);

    return () => {
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [eventEditionId, topic]);

  return { status };
}
