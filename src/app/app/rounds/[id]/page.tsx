import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { StatusPill, BackLink, ScoreSummary } from "@/components/bidwave";
import { classroomStatus } from "@/lib/round-status-ui";
import { SubmissionForm } from "@/app/app/rounds/[id]/submission-form";

export const metadata: Metadata = { title: "Round" };

// See the matching note in src/app/app/page.tsx: a freshly published score
// must not be hidden behind a cached RSC payload.
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

export default async function TeamRoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: round } = await supabase.from("rounds_with_status").select("*").eq("id", id).maybeSingle();
  if (!round) notFound();

  const [{ data: materials }, { data: criteria }, { data: submission }, { data: score }, { data: canSubmit }, { data: quizAttempt }] =
    await Promise.all([
      supabase.from("round_materials").select("*").eq("round_id", id).order("position"),
      supabase.from("rubric_criteria").select("*").eq("round_id", id).order("position"),
      supabase
        .from("submissions")
        .select("status, submitted_at, submission_files(id, file_name, storage_path, uploaded_at, superseded_at)")
        .eq("round_id", id)
        .eq("team_id", user.id)
        .maybeSingle(),
      supabase.from("scores").select("*").eq("round_id", id).eq("team_id", user.id).maybeSingle(),
      supabase.rpc("can_team_submit", { p_round_id: id, p_team_id: user.id }),
      supabase
        .from("quiz_attempts")
        .select("status, correct_count, question_count, percent")
        .eq("round_id", id)
        .eq("team_id", user.id)
        .neq("status", "archived")
        .maybeSingle(),
    ]);

  // Invite-only rounds (the Round 1 re-attempt) are not reachable by URL for
  // a team that isn't on the allowlist. Cosmetic on top of
  // start_quiz_attempt's [not_eligible] raise, but it keeps a shared link
  // from looking like a round that's merely broken.
  if (round.is_invite_only) {
    const { data: eligible } = await supabase
      .from("round_eligible_teams")
      .select("round_id")
      .eq("round_id", id)
      .eq("team_id", user.id)
      .maybeSingle();
    if (!eligible) notFound();
  }

  // Quiz rounds track completion via quiz_attempts, not submissions.
  const submissionStatus =
    round.kind === "quiz"
      ? quizAttempt?.status === "submitted"
        ? "submitted"
        : "not_submitted"
      : submission?.status;

  const status = classroomStatus({
    roundStatus: round.status,
    submissionStatus,
    canSubmit: canSubmit ?? false,
    scorePublished: score?.published,
  });

  const currentFiles = (submission?.submission_files ?? []).filter((f) => !f.superseded_at);

  // Audit high-priority #12: only total/notes were ever shown, never the
  // criterion-by-criterion breakdown — score_criterion_values is already
  // RLS-readable by the team once their score is published.
  const { data: criterionValues } =
    score?.published && score.id
      ? await supabase.from("score_criterion_values").select("criterion_id, value").eq("score_id", score.id)
      : { data: null };
  const criterionValueById = new Map((criterionValues ?? []).map((cv) => [cv.criterion_id, cv.value]));

  // Signed URLs are minted through the team's own RLS-bound client — the
  // round-materials bucket's SELECT policy (audit high-priority #5) only
  // allows this when a round_materials row for this exact storage_path
  // exists, so an unauthorized path can never produce a working link.
  const fileMaterials = (materials ?? []).filter((m) => m.kind === "file" && m.storage_path);
  const fileDownloadUrls = new Map(
    (
      await Promise.all(
        fileMaterials.map(async (m) => {
          const { data } = await supabase.storage.from("round-materials").createSignedUrl(m.storage_path!, 300);
          return [m.id, data?.signedUrl ?? null] as const;
        }),
      )
    ).filter(([, url]) => url !== null),
  );

  // A6: teams could see the filename of what they submitted but never a
  // way to actually open it — mint signed URLs the same way round_materials
  // does above. RLS (submission_files_select_own_or_admin, storage policy)
  // still gates this to the round's own team and only while genuinely open.
  const submissionDownloadUrls = new Map(
    (
      await Promise.all(
        currentFiles.map(async (f) => {
          const { data } = await supabase.storage.from("submissions").createSignedUrl(f.storage_path, 300);
          return [f.id, data?.signedUrl ?? null] as const;
        }),
      )
    ).filter(([, url]) => url !== null),
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-12">
      <BackLink href="/app" label="Back to dashboard" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">{round.title}</h1>
          {round.opens_at && (
            <p className="text-xs text-ink-3">
              {formatTimestamp(round.opens_at)}
              {round.closes_at ? ` – ${formatTimestamp(round.closes_at)}` : ""}
            </p>
          )}
        </div>
        <StatusPill status={status} />
      </div>

      {round.brief && <p className="text-sm leading-relaxed text-ink-2">{round.brief}</p>}
      {round.instructions && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{round.instructions}</p>
      )}

      {materials && materials.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
            Materials
          </h2>
          <ul className="space-y-1.5 text-sm">
            {materials.map((m) => (
              <li key={m.id} className="rounded-lg border border-border bg-card px-3 py-2">
                <span className="font-medium">{m.title}</span>
                {m.kind === "text" && <p className="mt-1 whitespace-pre-wrap text-ink-2">{m.body}</p>}
                {m.kind === "link" && (
                  <a href={m.url ?? "#"} target="_blank" rel="noreferrer" className="ml-2 text-gold hover:underline">
                    Open
                  </a>
                )}
                {m.kind === "file" &&
                  (fileDownloadUrls.get(m.id) ? (
                    <a
                      href={fileDownloadUrls.get(m.id)!}
                      className="ml-2 text-gold hover:underline"
                    >
                      Download
                    </a>
                  ) : (
                    <span className="ml-2 text-xs text-ink-3">Unavailable</span>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {criteria && criteria.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
            Rubric
          </h2>
          <ul className="space-y-1 text-sm text-ink-2">
            {criteria.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span>{c.label}</span>
                <span className="font-mono tabular-nums">/ {c.max_value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {round.kind === "submission" && (
        <div className="space-y-3">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
            Submission
          </h2>

          {currentFiles.length > 0 && (
            <ul className="space-y-1 text-sm">
              {currentFiles.map((f) => {
                const url = submissionDownloadUrls.get(f.id);
                return (
                  <li key={f.id} className="text-ink-2">
                    {url ? (
                      <a href={url} className="text-gold hover:underline">
                        {f.file_name}
                      </a>
                    ) : (
                      f.file_name
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {submission?.submitted_at && (
            <p className="text-xs text-ink-3">
              Submitted {formatTimestamp(submission.submitted_at)}
            </p>
          )}

          {round.status === "closed" ? (
            <p className="text-sm text-ink-2">Submission is closed. Files can no longer be viewed or replaced.</p>
          ) : (
            <SubmissionForm roundId={id} disabled={!canSubmit} />
          )}
        </div>
      )}

      {round.kind === "quiz" &&
        (quizAttempt?.status === "submitted" ? (
          <p className="text-sm text-ink-2">Your attempt has been submitted.</p>
        ) : (
          <Link
            href={`/app/quiz/${id}`}
            className="inline-flex rounded-lg bg-gold px-4 py-2 font-heading text-sm font-semibold text-primary-foreground hover:bg-gold-bright"
          >
            Go to quiz
          </Link>
        ))}

      {score?.published && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
            Your score
          </h2>
          <ScoreSummary
            total={score.total}
            maxTotal={score.max_total}
            source={score.source}
            correctCount={quizAttempt?.correct_count ?? null}
            questionCount={quizAttempt?.question_count ?? null}
            percent={quizAttempt?.percent ?? null}
          />
          {criteria && criteria.length > 0 && criterionValueById.size > 0 && (
            <ul className="space-y-1 border-t border-border pt-2 text-sm text-ink-2">
              {criteria.map((c) => (
                <li key={c.id} className="flex justify-between">
                  <span>{c.label}</span>
                  <span className="font-mono tabular-nums">
                    {criterionValueById.get(c.id) ?? "—"} / {c.max_value}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {score.notes && <p className="text-sm text-ink-2">{score.notes}</p>}
        </div>
      )}
    </div>
  );
}
