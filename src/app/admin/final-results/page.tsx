import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getStageStandings } from "@/app/admin/stages/actions";
import { LeaderboardPublisher } from "@/app/admin/leaderboard/leaderboard-publisher";
import { DataTable, type DataTableColumn } from "@/components/bidwave";

export const metadata: Metadata = { title: "Final Results" };
export const dynamic = "force-dynamic";

type Standing = { team_id: string; team_name: string; aggregate: number; rank: number };

/**
 * R6-05/§18: no hardcoded combination formula. This page is a review
 * surface only — it shows the final-stage aggregate (R1-R4 + any
 * stage_adjustments) and Round 6's standalone standing side by side, plus
 * every stage's qualification decision for context, so the admin can build
 * the explicit Top 10 array with full information. The array itself is
 * still constructed and published through the same LeaderboardPublisher
 * component already used on /admin/leaderboard — moved here so review and
 * publish happen in one place. /admin/leaderboard keeps only top_15.
 */
export default async function AdminFinalResultsPage() {
  const supabase = await createClient();
  const { data: edition } = await supabase.from("event_editions").select("id").eq("is_active", true).maybeSingle();

  const [{ data: stages }, { data: teams }, { data: qualifications }, { data: liveFinal }] = await Promise.all([
    supabase.from("stages").select("id, code, label").eq("event_edition_id", edition?.id ?? "").order("code"),
    supabase.from("teams").select("id, name").eq("event_edition_id", edition?.id ?? "").order("name"),
    supabase.from("qualifications").select("stage_id, team_id, decision, rank"),
    supabase
      .from("leaderboard_snapshots")
      .select("id, published_at, hidden_at, leaderboard_snapshot_entries(rank, team_name, score)")
      .eq("event_edition_id", edition?.id ?? "")
      .eq("kind", "final_top_10")
      .is("hidden_at", null)
      .maybeSingle(),
  ]);

  const finalStage = (stages ?? []).find((s) => s.code === "final");
  const r6Stage = (stages ?? []).find((s) => s.code === "r6");

  const [finalStandings, r6Standings] = await Promise.all([
    finalStage ? (getStageStandings(finalStage.id) as Promise<Standing[]>) : Promise.resolve([]),
    r6Stage ? (getStageStandings(r6Stage.id) as Promise<Standing[]>) : Promise.resolve([]),
  ]);

  const finalByTeam = new Map(finalStandings.map((s) => [s.team_id, s]));
  const r6ByTeam = new Map(r6Standings.map((s) => [s.team_id, s]));

  const decisionsByTeamAndStage = new Map<string, Map<string, string>>();
  for (const q of qualifications ?? []) {
    if (!decisionsByTeamAndStage.has(q.team_id)) decisionsByTeamAndStage.set(q.team_id, new Map());
    const stageCode = (stages ?? []).find((s) => s.id === q.stage_id)?.code ?? q.stage_id;
    decisionsByTeamAndStage.get(q.team_id)!.set(stageCode, q.decision);
  }

  type Row = { id: string; name: string };
  const columns: DataTableColumn<Row>[] = [
    { key: "team", header: "Team", render: (r) => r.name },
    {
      key: "final",
      header: "Final-stage aggregate",
      render: (r) => {
        const s = finalByTeam.get(r.id);
        return s ? `#${s.rank} — ${s.aggregate}` : "—";
      },
    },
    {
      key: "r6",
      header: "Round 6 score",
      render: (r) => {
        const s = r6ByTeam.get(r.id);
        return s ? `#${s.rank} — ${s.aggregate}` : "—";
      },
    },
    {
      key: "reference",
      header: "Reference sum (not authoritative)",
      render: (r) => {
        const f = finalByTeam.get(r.id)?.aggregate ?? 0;
        const r6 = r6ByTeam.get(r.id)?.aggregate ?? 0;
        return <span className="text-ink-3">{f + r6}</span>;
      },
    },
    {
      key: "decisions",
      header: "Qualification decisions",
      render: (r) => {
        const decisions = decisionsByTeamAndStage.get(r.id);
        if (!decisions || decisions.size === 0) return "—";
        return Array.from(decisions.entries())
          .map(([stage, decision]) => `${stage}: ${decision}`)
          .join(" · ");
      },
    },
    {
      key: "links",
      header: "",
      render: () => (
        <div className="flex gap-3 text-xs">
          <Link href="/admin/auction/console" className="text-gold hover:underline">
            Auction
          </Link>
          <Link href="/admin/auction/analytics" className="text-gold hover:underline">
            Analytics
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Final results</h1>
        <p className="text-sm text-ink-2">
          R6-05: review every team&apos;s final-stage aggregate and standalone Round 6 score, then build the
          explicit Top 10 below — never a computed combination.
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={(teams ?? []).map((t) => ({ id: t.id, name: t.name }))}
        rowKey={(r) => r.id}
        emptyTitle="No teams yet"
      />

      <LeaderboardPublisher
        kind="final_top_10"
        label="Final Top 10"
        entryLimit={10}
        teams={teams ?? []}
        live={liveFinal as never}
      />
    </div>
  );
}
