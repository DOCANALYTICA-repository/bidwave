import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getStagesData } from "@/app/admin/stages/actions";
import { StagesLive } from "@/app/admin/stages/stages-live";

export const metadata: Metadata = { title: "Stages" };

export default async function AdminStagesPage() {
  const supabase = await createClient();
  const { data: edition } = await supabase.from("event_editions").select("id").eq("is_active", true).maybeSingle();
  const eventEditionId = edition?.id ?? null;

  const initial = await getStagesData();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Stages</h1>
        <p className="text-sm text-ink-2">
          §12.2: review the aggregate, then manually confirm each team&apos;s qualification decision.
        </p>
      </div>
      <StagesLive eventEditionId={eventEditionId} initial={initial} />
    </div>
  );
}
