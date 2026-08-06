import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatusPill, EmptyState } from "@/components/bidwave";
import { classroomStatus } from "@/lib/round-status-ui";

export const metadata: Metadata = { title: "Dashboard" };

// Explicit locale/options for consistent display regardless of the
// server's locale config — same convention as activity-log.tsx and
// console-sales-log.tsx elsewhere in this codebase.
function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    hour12: false,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function TeamDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: team } = user
    ? await supabase.from("teams").select("name, campus, status").eq("id", user.id).maybeSingle()
    : { data: null };

  const { data: rounds } = await supabase
    .from("rounds_with_status")
    .select("*")
    .order("sequence", { ascending: true });

  // Audit high-priority #13: the announcements table/RPC existed with no
  // team-facing feed anywhere reading it.
  const { data: announcements } = await supabase
    .from("announcements")
    .select("id, message, created_at")
    .eq("visibility", "published")
    .in("audience", ["all", "team"])
    .order("created_at", { ascending: false })
    .limit(5);

  const teamId = user?.id;
  const [{ data: submissions }, { data: scores }, { data: qualifications }, { data: quizAttempts }] = teamId
    ? await Promise.all([
        supabase.from("submissions").select("round_id, status, submitted_at").eq("team_id", teamId),
        supabase.from("scores").select("round_id, total, max_total, published").eq("team_id", teamId),
        supabase.from("qualifications").select("stage_id, rank, decision").eq("team_id", teamId),
        supabase.from("quiz_attempts").select("round_id, status").eq("team_id", teamId).neq("status", "archived"),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }];

  // C2: the "More" section's simulation link should only appear once an
  // admin has revealed it — otherwise every team saw a live entry point to
  // a page that just says "not visible yet" via notFound().
  const admin = createAdminClient();
  const { data: simulationConfig } = await admin
    .from("simulation_config")
    .select("visible_at")
    .not("visible_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const simulationVisible = !!simulationConfig;

  const submissionByRound = new Map((submissions ?? []).map((s) => [s.round_id, s]));
  const scoreByRound = new Map((scores ?? []).map((s) => [s.round_id, s]));
  // Quiz rounds track completion via quiz_attempts, not the submissions
  // table (that's only for kind='submission') — mapped to the same shape
  // so classroomStatus doesn't need to know which table a round uses.
  const quizAttemptByRound = new Map(
    (quizAttempts ?? []).map((a) => [
      a.round_id,
      { status: (a.status === "submitted" ? "submitted" : "not_submitted") as "submitted" | "not_submitted" },
    ]),
  );

  const eligibility: Record<string, boolean> = {};
  if (teamId && rounds) {
    await Promise.all(
      rounds.map(async (r) => {
        const { data } = await supabase.rpc("can_team_submit", {
          p_round_id: r.id,
          p_team_id: teamId,
        });
        eligibility[r.id] = data ?? false;
      }),
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-12">
      <div>
        <p className="font-heading text-xs font-semibold uppercase tracking-wide text-gold">
          Team dashboard
        </p>
        <h1 className="font-display text-3xl">{team?.name ?? "Welcome"}</h1>
        <p className="text-sm text-ink-2">{team?.campus}</p>
      </div>

      {team && team.status === "disqualified" && <StatusPill status="eliminated" label="Disqualified" />}

      {announcements && announcements.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
            Announcements
          </h2>
          <ul className="space-y-2">
            {announcements.map((a) => (
              <li key={a.id} className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-sm">
                <p className="whitespace-pre-wrap text-ink-2">{a.message}</p>
                <p className="mt-1 text-xs text-ink-3">{formatTimestamp(a.created_at)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {qualifications && qualifications.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {qualifications.map((q) => (
            <StatusPill
              key={q.stage_id}
              status={q.decision === "qualified" ? "qualified" : q.decision === "eliminated" ? "eliminated" : "upcoming"}
              label={
                q.decision === "pending"
                  ? "Qualification pending"
                  : `${q.decision === "qualified" ? "Qualified" : "Eliminated"}${q.rank ? ` · Rank ${q.rank}` : ""}`
              }
            />
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
          Rounds
        </h2>
        {!rounds || rounds.length === 0 ? (
          <EmptyState title="No rounds released yet" description="Check back once Round 1 opens." />
        ) : (
          <ul className="space-y-3">
            {rounds.map((round) => {
              const submission =
                round.kind === "quiz" ? quizAttemptByRound.get(round.id) : submissionByRound.get(round.id);
              const score = scoreByRound.get(round.id);
              const status = classroomStatus({
                roundStatus: round.status,
                submissionStatus: submission?.status,
                canSubmit: eligibility[round.id] ?? false,
                scorePublished: score?.published,
              });
              return (
                <li key={round.id}>
                  <Link
                    href={round.kind === "auction" ? "/app/auction" : `/app/rounds/${round.id}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-gold/40"
                  >
                    <div className="min-w-0">
                      <p className="font-heading text-sm font-semibold">{round.title}</p>
                      {round.opens_at && (
                        <p className="text-xs text-ink-3">
                          {formatTimestamp(round.opens_at)}
                          {round.closes_at ? ` – ${formatTimestamp(round.closes_at)}` : ""}
                        </p>
                      )}
                      {score?.published && (
                        <p className="mt-1 font-mono text-xs tabular-nums text-ink-2">
                          Score: {score.total}
                          {score.max_total ? ` / ${score.max_total}` : ""}
                        </p>
                      )}
                    </div>
                    <StatusPill status={status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Audit high-priority #8: simulation had no link anywhere in the
          team workflow — it isn't one of the six brochure rounds (no
          `rounds` row of kind 'simulation' exists), so it can't appear in
          the loop above and needs its own persistent entry point. C2: only
          rendered once an admin has revealed it. */}
      {simulationVisible && (
        <div className="space-y-3">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">More</h2>
          <Link
            href="/app/simulation"
            className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-gold/40"
          >
            <div>
              <p className="font-heading text-sm font-semibold">On-spot simulation</p>
              <p className="text-xs text-ink-3">First-correct-wins — attempt the live simulation.</p>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
