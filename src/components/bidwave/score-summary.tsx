/**
 * The one team-facing rendering of a round score.
 *
 * Round 1 shipped showing only "32.00 / 39.00" and teams reported it as
 * wrong: the Stat Sprint's 35 questions carry 0.5/1/2 point weights, so a
 * team that got 29 of 35 right scores 32 of 39 points, and neither number
 * explains the other. Nothing on screen said so, and the correct-answer
 * count can't be derived client-side either — quiz_options.is_correct is
 * admin-only RLS by design, so a team must never be able to compute it.
 * quiz_attempts.correct_count / .question_count (migration
 * 20260814050000) materialise it server-side; this component is where all
 * three numbers finally appear together.
 *
 * Used by both team surfaces (/app and /app/rounds/[id]) so they can never
 * drift apart again.
 */

/**
 * Trim pointless trailing zeros without losing genuine half-points:
 * 32.00 -> "32", 35.50 -> "35.5". Rendering the raw numeric ("32") next to
 * a padded one ("39.00") is exactly the kind of mismatch that reads as a
 * bug to someone already suspicious of their score.
 */
function formatPoints(value: number) {
  return Number(value.toFixed(2)).toString();
}

export type ScoreSummaryProps = {
  total: number;
  maxTotal: number | null;
  /**
   * Only 'quiz' scores are described by correctCount/questionCount. An
   * admin override (source 'manual') replaces the total with a number the
   * counts no longer explain, so the breakdown is suppressed rather than
   * shown alongside a figure it contradicts.
   */
  source: string;
  correctCount: number | null;
  questionCount: number | null;
  percent: number | null;
  /** Compact single-line variant for the dashboard round list. */
  compact?: boolean;
};

export function ScoreSummary({
  total,
  maxTotal,
  source,
  correctCount,
  questionCount,
  percent,
  compact = false,
}: ScoreSummaryProps) {
  const points = maxTotal ? `${formatPoints(total)} / ${formatPoints(maxTotal)}` : formatPoints(total);

  const showBreakdown =
    source === "quiz" && correctCount !== null && questionCount !== null && questionCount > 0;

  const percentLabel = percent !== null ? `${Math.round(percent)}%` : null;

  if (compact) {
    return (
      <p className="mt-1 font-mono text-xs tabular-nums text-ink-2">
        Score: {points} points
        {showBreakdown && ` · ${correctCount} of ${questionCount} correct`}
        {percentLabel && ` · ${percentLabel}`}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="font-mono text-xl tabular-nums">{points} points</p>
      {showBreakdown && (
        <p className="font-mono text-sm tabular-nums text-ink-2">
          {correctCount} of {questionCount} correct
          {percentLabel && ` · ${percentLabel}`}
        </p>
      )}
      {showBreakdown && (
        <p className="text-xs leading-relaxed text-ink-3">
          Questions carry different point weights, so your points are not out of {questionCount}.
        </p>
      )}
    </div>
  );
}
