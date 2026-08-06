import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getTeamsData } from "@/app/admin/teams/actions";
import { TeamsLive } from "@/app/admin/teams/teams-live";

export const metadata: Metadata = { title: "Teams" };

export default async function AdminTeamsPage() {
  const supabase = await createClient();
  const { data: edition } = await supabase.from("event_editions").select("id").eq("is_active", true).maybeSingle();
  const eventEditionId = edition?.id ?? null;

  const initial = eventEditionId ? await getTeamsData(eventEditionId) : { teams: [], error: null };

  return <TeamsLive eventEditionId={eventEditionId} initial={initial} />;
}
