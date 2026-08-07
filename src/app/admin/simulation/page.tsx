import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSimulationData } from "@/app/admin/simulation/actions";
import { SimulationLive } from "@/app/admin/simulation/simulation-live";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Simulation" };

export default async function AdminSimulationPage() {
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  const eventEditionId = edition?.id ?? null;

  const initial = eventEditionId
    ? await getSimulationData(eventEditionId)
    : { config: null, attempts: [], rounds: [], teams: [], rewards: [] };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">On-spot simulation</h1>
        <p className="text-sm text-ink-2">SIM-01..11: start, monitor, confirm winners, assign reward.</p>
      </div>
      <SimulationLive eventEditionId={eventEditionId} initial={initial} />
    </div>
  );
}
