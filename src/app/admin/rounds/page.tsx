import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getRoundsData } from "@/app/admin/rounds/actions";
import { RoundsLive } from "@/app/admin/rounds/rounds-live";

export const metadata: Metadata = { title: "Rounds" };

export default async function AdminRoundsPage() {
  const supabase = await createClient();
  const { data: edition } = await supabase.from("event_editions").select("id").eq("is_active", true).maybeSingle();
  const eventEditionId = edition?.id ?? null;

  const initial = await getRoundsData();

  return <RoundsLive eventEditionId={eventEditionId} initial={initial} />;
}
