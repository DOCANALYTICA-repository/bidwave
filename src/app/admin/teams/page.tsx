import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getTeamsData } from "@/app/admin/teams/actions";
import { TeamsLive } from "@/app/admin/teams/teams-live";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Teams" };

export default async function AdminTeamsPage() {
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  const eventEditionId = edition?.id ?? null;

  const initial = eventEditionId ? await getTeamsData(eventEditionId) : { teams: [], error: null };

  return <TeamsLive eventEditionId={eventEditionId} initial={initial} />;
}
