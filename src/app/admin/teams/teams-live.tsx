"use client";

import { useAdminLiveQuery } from "@/lib/realtime/use-admin-live-query";
import { TeamsTable } from "@/app/admin/teams/teams-table";
import { getTeamsData, type TeamsQueryResult } from "@/app/admin/teams/actions";

export function TeamsLive({
  eventEditionId,
  initial,
}: {
  eventEditionId: string | null;
  initial: TeamsQueryResult;
}) {
  const { data } = useAdminLiveQuery<TeamsQueryResult>({
    queryKey: ["admin", "teams", eventEditionId],
    queryFn: () => getTeamsData(eventEditionId ?? ""),
    initialData: initial,
    eventEditionId,
    topic: "teams",
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Teams</h1>
        <p className="text-sm text-ink-2">
          {data.teams.length} registered team{data.teams.length === 1 ? "" : "s"}
        </p>
      </div>
      {data.error && (
        <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
          Could not load teams: {data.error}
        </p>
      )}
      <TeamsTable teams={data.teams} />
    </div>
  );
}
