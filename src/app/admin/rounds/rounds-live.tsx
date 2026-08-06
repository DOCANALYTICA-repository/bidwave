"use client";

import { useAdminLiveQuery } from "@/lib/realtime/use-admin-live-query";
import { RoundsTable } from "@/app/admin/rounds/rounds-table";
import { getRoundsData, type RoundsQueryResult } from "@/app/admin/rounds/actions";

export function RoundsLive({
  eventEditionId,
  initial,
}: {
  eventEditionId: string | null;
  initial: RoundsQueryResult;
}) {
  const { data } = useAdminLiveQuery<RoundsQueryResult>({
    queryKey: ["admin", "rounds", eventEditionId],
    queryFn: getRoundsData,
    initialData: initial,
    eventEditionId,
    topic: "rounds",
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Rounds</h1>
        <p className="text-sm text-ink-2">{data.rounds.length} round(s)</p>
      </div>
      {data.error && (
        <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
          Could not load rounds: {data.error}
        </p>
      )}
      <RoundsTable rounds={data.rounds} stages={data.stages} />
    </div>
  );
}
