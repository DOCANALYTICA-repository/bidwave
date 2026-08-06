import type { Metadata } from "next";
import { getSettings } from "@/lib/supabase/settings";
import { PrizesSection } from "@/components/marketing/prizes-section";

export const metadata: Metadata = { title: "Prizes" };
export const dynamic = "force-dynamic";

export default async function PrizesPage() {
  const settings = await getSettings(["prizes"]);
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-16">
      <div className="text-center">
        <h1 className="font-display text-4xl">Prizes</h1>
      </div>
      <PrizesSection prizes={settings.prizes} />
    </div>
  );
}
