import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { selectCurrentEdition } from "@/lib/event-edition";
import { EmptyState } from "@/components/bidwave";
import { LeaderboardBoard, type Entry } from "@/app/(public)/leaderboard/leaderboard-board";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

/**
 * Formatted here, on the server, with an explicit timezone as well as an
 * explicit locale: the board is a client component, so a bare toLocaleString
 * would render in UTC during SSR and in the viewer's zone after hydration —
 * a guaranteed mismatch (the same class of bug already hit
 * console-sales-log.tsx). The event is in Bengaluru, so IST is also simply
 * the right thing for a public audience to read.
 */
function formatPublishedAt(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: true,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * LDB-03/PUB-04/PUB-07: rank, team name and current published cumulative
 * score only — never register numbers/emails/phones (SEC-11). Both
 * snapshot kinds can legitimately be live at once (publishing one kind
 * only auto-hides that same kind's prior snapshot), so both are queried
 * and rendered independently rather than assuming one implies the other
 * is hidden.
 */
export default async function PublicLeaderboardPage() {
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);

  // Edition-scoped. admin_publish_leaderboard only auto-hides prior
  // snapshots of the same kind *within its own edition*, and the RLS policy
  // only checks hidden_at — so a snapshot published against any other
  // edition stays live here too, and the find() below would pick between
  // them by whatever order PostgREST happened to return.
  const { data: snapshots } = edition
    ? await supabase
        .from("leaderboard_snapshots")
        .select("kind, published_at, covers_label, leaderboard_snapshot_entries(rank, team_name, score)")
        .eq("event_edition_id", edition.id)
        .in("kind", ["top_15", "final_top_10"])
        .is("hidden_at", null)
    : { data: null };

  const topFifteen = snapshots?.find((s) => s.kind === "top_15");
  const finalTopTen = snapshots?.find((s) => s.kind === "final_top_10");

  const sortEntries = (entries: Entry[] | undefined) =>
    (entries ?? []).slice().sort((a, b) => a.rank - b.rank);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-12 px-6 py-16">
      <div className="text-center">
        <h1 className="font-display text-4xl">Leaderboard</h1>
      </div>

      {finalTopTen && (
        <LeaderboardBoard
          title="Final Results"
          coversLabel={finalTopTen.covers_label}
          publishedLabel={formatPublishedAt(finalTopTen.published_at)}
          entries={sortEntries(finalTopTen.leaderboard_snapshot_entries)}
        />
      )}

      {topFifteen && (
        // Not "Live Standings": this is a snapshot an admin publishes by
        // hand, so calling it live promises an update cadence that does not
        // exist. The covers_label carries what it actually reflects.
        <LeaderboardBoard
          title="Standings — Top 15"
          coversLabel={topFifteen.covers_label}
          publishedLabel={formatPublishedAt(topFifteen.published_at)}
          entries={sortEntries(topFifteen.leaderboard_snapshot_entries)}
        />
      )}

      {!finalTopTen && !topFifteen && (
        <EmptyState
          title="Nothing published yet"
          description="Check back once the admin publishes standings."
        />
      )}
    </div>
  );
}
