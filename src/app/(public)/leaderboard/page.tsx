import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/bidwave";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

type Entry = { rank: number; team_name: string; score: number };

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
  const { data: snapshots } = await supabase
    .from("leaderboard_snapshots")
    .select("kind, published_at, leaderboard_snapshot_entries(rank, team_name, score)")
    .in("kind", ["top_15", "final_top_10"])
    .is("hidden_at", null);

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
        <LeaderboardTable
          title="Final Results"
          entries={sortEntries(finalTopTen.leaderboard_snapshot_entries)}
          emphasize
        />
      )}

      {topFifteen && (
        <LeaderboardTable
          title="Live Standings — Top 15"
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

function LeaderboardTable({
  title,
  entries,
  emphasize,
}: {
  title: string;
  entries: Entry[];
  emphasize?: boolean;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-gold">
        {title}
      </h2>
      <ol className="space-y-2">
        {entries.map((e) => {
          const top3 = e.rank <= 3;
          return (
            <li
              key={e.rank}
              className={
                emphasize && top3
                  ? "flex items-center justify-between rounded-lg border border-gold/30 bg-gold/5 px-4 py-3"
                  : "flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2"
              }
            >
              <span className="flex items-center gap-3">
                <span
                  className={
                    emphasize && top3
                      ? "font-mono text-sm font-bold tabular-nums text-gold"
                      : "font-mono text-sm tabular-nums text-ink-3"
                  }
                >
                  {e.rank}
                </span>
                <span className="font-medium">{e.team_name}</span>
              </span>
              <span className="font-mono tabular-nums text-gold">{e.score}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
