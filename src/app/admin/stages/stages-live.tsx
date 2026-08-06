"use client";

import { useAdminLiveQuery } from "@/lib/realtime/use-admin-live-query";
import { StagePanel } from "@/app/admin/stages/stage-panel";
import { getStagesData, type StagesQueryResult } from "@/app/admin/stages/actions";

export function StagesLive({
  eventEditionId,
  initial,
}: {
  eventEditionId: string | null;
  initial: StagesQueryResult;
}) {
  const { data, dataUpdatedAt } = useAdminLiveQuery<StagesQueryResult>({
    queryKey: ["admin", "stages", eventEditionId],
    queryFn: getStagesData,
    initialData: initial,
    eventEditionId,
    topic: "stages",
  });

  if (data.stages.length === 0) {
    return (
      <p className="text-sm text-ink-2">
        No stages configured yet. Create one directly via a future stage builder, or seed r1_r2 /
        r3_r4 / r6 / final for this event edition.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {data.stages.map((s) => (
        <StagePanel
          key={s.id}
          stageId={s.id}
          label={s.label}
          rounds={data.rounds}
          initialRoundWeights={data.stageRounds.filter((sr) => sr.stage_id === s.id)}
          refreshSignal={dataUpdatedAt}
        />
      ))}
    </div>
  );
}
