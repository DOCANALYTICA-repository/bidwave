"use client";

import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";
import type { ConnectionStatus } from "@/components/bidwave";

/**
 * The Phase-5 admin data-layer primitive: a React Query cache instead of a
 * server-component refetch-on-navigation, kept fresh by the Phase-4
 * broadcast_live() topics instead of a manual nav or router.refresh().
 * `initialData` is the one server-side fetch page.tsx already did for the
 * cold-navigation paint — no flash-of-empty-cache, no duplicate query on
 * mount.
 */
export function useAdminLiveQuery<T>({
  queryKey,
  queryFn,
  initialData,
  eventEditionId,
  topic,
}: {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  initialData: T;
  eventEditionId: string | null;
  topic: string;
}): { data: T; isFetching: boolean; status: ConnectionStatus; dataUpdatedAt: number } {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey,
    queryFn,
    initialData,
  });

  const { status } = useLiveBroadcast(eventEditionId, topic, () => {
    queryClient.invalidateQueries({ queryKey });
  });

  return {
    data: query.data ?? initialData,
    isFetching: query.isFetching,
    status,
    // Exposed so a consumer with its own nested client-fetched state (e.g.
    // StagePanel's per-stage standings) can key/remount off it to refetch
    // in step with this topic's pings, without every such nested fetch
    // needing its own useLiveBroadcast subscription.
    dataUpdatedAt: query.dataUpdatedAt,
  };
}
