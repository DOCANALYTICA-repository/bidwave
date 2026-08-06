"use client";

import { useAdminLiveQuery } from "@/lib/realtime/use-admin-live-query";
import { SimulationAdmin } from "@/app/admin/simulation/simulation-admin";
import { getSimulationData, type SimulationQueryResult } from "@/app/admin/simulation/actions";

export function SimulationLive({
  eventEditionId,
  initial,
}: {
  eventEditionId: string | null;
  initial: SimulationQueryResult;
}) {
  const { data } = useAdminLiveQuery<SimulationQueryResult>({
    queryKey: ["admin", "simulation", eventEditionId],
    queryFn: () => getSimulationData(eventEditionId ?? ""),
    initialData: initial,
    eventEditionId,
    topic: "simulation",
  });

  return (
    <SimulationAdmin
      config={data.config}
      attempts={data.attempts}
      rounds={data.rounds}
      teams={data.teams}
      rewards={data.rewards}
    />
  );
}
