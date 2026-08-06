import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ROUND_COPY_LIST } from "@/lib/rounds-catalog";
import { RoundCard } from "@/components/marketing/round-card";

export const metadata: Metadata = { title: "Rounds" };
export const dynamic = "force-dynamic";

export default async function RoundsPage() {
  const supabase = await createClient();
  const { data: rounds } = await supabase.from("rounds_with_status").select("slug");
  const releasedSlugs = new Set((rounds ?? []).map((r) => r.slug));

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-16">
      <div className="text-center">
        <h1 className="font-display text-4xl">Six Rounds. One Champion.</h1>
        <p className="mt-2 text-ink-2">
          Each round narrows the field until only the sharpest franchise owners remain.
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {ROUND_COPY_LIST.map((copy) => (
          <RoundCard
            key={copy.slug}
            copy={copy}
            hasPublicMaterials={releasedSlugs.has(copy.slug)}
          />
        ))}
      </div>
    </div>
  );
}
