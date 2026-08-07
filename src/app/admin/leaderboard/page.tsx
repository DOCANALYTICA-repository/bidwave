import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLeaderboardData } from "@/app/admin/leaderboard/actions";
import { LeaderboardLive } from "@/app/admin/leaderboard/leaderboard-live";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Leaderboard" };

/**
 * Only publishes top_15 — final_top_10 publishing moved to
 * /admin/final-results (Phase 8), which pairs it with the actual review
 * data (final-stage aggregate + standalone Round 6 score) needed to build
 * an informed Top 10, rather than a bare publisher with no context.
 */
export default async function AdminLeaderboardPage() {
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  const eventEditionId = edition?.id ?? null;

  const initial = eventEditionId
    ? await getLeaderboardData(eventEditionId)
    : { teams: [], live: null };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Leaderboard</h1>
        <p className="text-sm text-ink-2">
          LDB-04: entering scores never moves this automatically — publish explicitly. The Final Top 10
          is published from <Link href="/admin/final-results" className="text-gold hover:underline">Final results</Link>.
        </p>
      </div>
      <LeaderboardLive eventEditionId={eventEditionId} initial={initial} />
    </div>
  );
}
