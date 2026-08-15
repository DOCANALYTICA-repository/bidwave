import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatusPill, EmptyState, ScoreSummary } from "@/components/bidwave";
import { classroomStatus } from "@/lib/round-status-ui";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Dashboard" };

// Scores are published by an explicit admin action, and a team refreshing
// after that action must see the change — with the default caching this
// page's RSC payload can be served from the client router cache long after
// the score landed, which reads to the team as "my score is wrong".
export const dynamic = "force-dynamic";

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

  const { data: edition } = await selectCurrentEdition(supabase);
  const { data: rounds } = edition
    ? await supabase
        .from("rounds_with_status")
        .select("*")
        .eq("event_edition_id", edition.id)
        .order("sequence", { ascending: true })
    : { data: [] };

  // Audit high-priority #13: the announcements table/RPC existed with no
  // team-facing feed anywhere reading it.
  // Edition-scoped: RLS only requires published + audience, so without this
  // filter an announcement from any other edition (a rehearsal one, say)
  // would show on every real team's dashboard.
  const { data: announcements } = edition
    ? await supabase
        .from("announcements")
        .select("id, message, created_at")
        .eq("event_edition_id", edition.id)
        .eq("visibility", "published")
        .in("audience", ["all", "team"])
        .order("created_at", { ascending: false })
        .limit(5)
    : { data: null };

  const teamId = user?.id;
  const [{ data: submissions }, { data: scores }, { data: qualifications }, { data: quizAttempts }] = teamId
    ? await Promise.all([
        supabase.from("submissions").select("round_id, status, submitted_at").eq("team_id", teamId),
        supabase
          .from("scores")
          .select("round_id, total, max_total, source, published")
          .eq("team_id", teamId),
        supabase.from("qualifications").select("stage_id, rank, decision").eq("team_id", teamId),
        // correct_count/question_count/percent are what make the published
        // score legible — see ScoreSummary.
        supabase
          .from("quiz_attempts")
          .select("round_id, status, correct_count, question_count, percent")
          .eq("team_id", teamId)
          .neq("status", "archived"),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }];

  // C2: the "More" section's simulation link should only appear once an
  // admin has revealed it — otherwise every team saw a live entry point to
  // a page that just says "not visible yet" via notFound().
  // Scoped to this edition, matching the C3 fix already applied to the
  // simulation page itself — "is there *any* visible config anywhere" meant
  // revealing another edition's simulation lit the link up for every team here.
  const admin = createAdminClient();
  const { data: simulationConfig } = edition
    ? await admin
        .from("simulation_config")
        .select("visible_at")
        .eq("event_edition_id", edition.id)
        .not("visible_at", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
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
  const quizDetailByRound = new Map((quizAttempts ?? []).map((a) => [a.round_id, a]));

  // Invite-only rounds (the Round 1 re-attempt) must not appear for teams
  // that aren't on the allowlist — otherwise all 94 teams see a re-sit they
  // can't take. Cosmetic only: start_quiz_attempt's [not_eligible] raise is
  // the actual gate.
  const { data: eligibleRows } = teamId
    ? await supabase.from("round_eligible_teams").select("round_id").eq("team_id", teamId)
    : { data: null };
  const eligibleRoundIds = new Set((eligibleRows ?? []).map((r) => r.round_id));
  const visibleRounds = (rounds ?? []).filter((r) => !r.is_invite_only || eligibleRoundIds.has(r.id));

  const eligibility: Record<string, boolean> = {};
  if (teamId) {
    await Promise.all(
      visibleRounds.map(async (r) => {
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
        {visibleRounds.length === 0 ? (
          <EmptyState title="No rounds released yet" description="Check back once Round 1 opens." />
        ) : (
          <ul className="space-y-3">
            {visibleRounds.map((round) => {
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
                        <ScoreSummary
                          compact
                          total={score.total}
                          maxTotal={score.max_total}
                          source={score.source}
                          correctCount={quizDetailByRound.get(round.id)?.correct_count ?? null}
                          questionCount={quizDetailByRound.get(round.id)?.question_count ?? null}
                          percent={quizDetailByRound.get(round.id)?.percent ?? null}
                        />
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
