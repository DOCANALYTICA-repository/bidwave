"use client";

import { useAdminLiveQuery } from "@/lib/realtime/use-admin-live-query";
import { LeaderboardPublisher } from "@/app/admin/leaderboard/leaderboard-publisher";
import { getLeaderboardData, type LeaderboardQueryResult } from "@/app/admin/leaderboard/actions";

export function LeaderboardLive({
  eventEditionId,
  initial,
}: {
  eventEditionId: string | null;
  initial: LeaderboardQueryResult;
}) {
  const { data } = useAdminLiveQuery<LeaderboardQueryResult>({
    queryKey: ["admin", "leaderboard", eventEditionId, "top_15"],
    queryFn: () => getLeaderboardData(eventEditionId ?? ""),
    initialData: initial,
    eventEditionId,
    topic: "leaderboard",
  });

  return (
    <LeaderboardPublisher
      kind="top_15"
      label="Public Top 15"
      entryLimit={15}
      teams={data.teams}
      live={data.live as never}
    />
  );
}
