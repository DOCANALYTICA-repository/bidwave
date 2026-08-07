"use client";

import { useEffect, useState } from "react";
import { RadialScore } from "@/components/bidwave/radial-score";
import { JerseySilhouette } from "@/app/app/simulation/jersey-silhouette";
import { ConfettiBurst } from "@/app/app/simulation/confetti-burst";

type Attempt = {
  id: string;
  overall: number;
  success: boolean;
  sub_scores: Record<string, number>;
  winner_rank: number | null;
};

const SUB_SCORE_ORDER: { key: string; label: string }[] = [
  { key: "batting", label: "BATTING" },
  { key: "bowling", label: "BOWLING" },
  { key: "leadership", label: "LEADERSHIP" },
  { key: "fielding", label: "FIELDING" },
  { key: "bench", label: "BENCH" },
  { key: "chemistry", label: "CHEMISTRY" },
];

/**
 * Plan spec result UI (.claude/plans/this-project-is-exclusively-starry-
 * shore.md): jersey-7 silhouette + "Team Balance Score" radial + six
 * labelled sub-score radials + a STAR PLAYER / AWAITING FORMULA / STANDBY
 * status line + the failure copy + tagline. Renders unconditionally
 * (unlike the old inline block, which only appeared once an attempt
 * existed) so STANDBY has somewhere to show before a team's first submit.
 */
export function SimulationResultPanel({
  result,
  isFreshSubmission,
}: {
  result: Attempt | null;
  isFreshSubmission: boolean;
}) {
  // Hydration-safe mount gate (same pattern as page-transition.tsx): the
  // server renders history[0] as the initial result, so the first client
  // render must match that exactly — no animation — before diverging.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const animate = mounted && isFreshSubmission;
  const tone = !result ? "standby" : result.success ? "success" : "failure";
  const statusLabel = !result ? "● STANDBY" : result.success ? "STAR PLAYER" : "AWAITING FORMULA";
  const statusClass = tone === "success" ? "text-sold" : tone === "failure" ? "text-ink-2" : "text-ink-3";

  return (
    <div
      key={result?.id ?? "standby"}
      className="relative space-y-6 overflow-hidden rounded-xl border border-border bg-card p-6 text-center"
    >
      {tone === "success" && animate && <ConfettiBurst />}

      <JerseySilhouette tone={tone} />

      <p
        data-testid="sim-status"
        aria-live="polite"
        className={`font-heading text-sm font-semibold uppercase tracking-wide ${statusClass}`}
      >
        {statusLabel}
        {result?.winner_rank && ` · Winner rank ${result.winner_rank}`}
      </p>

      <div data-testid="sim-overall-score">
        <RadialScore
          label="Team Balance Score"
          value={result?.overall ?? 0}
          size="lg"
          tone={tone === "success" ? "success" : "gold"}
          animate={animate}
        />
      </div>

      {result && !result.success && (
        <p className="text-sm text-ink-2">
          This combination is not one of the four championship formulas. Recalibrate and try again.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {SUB_SCORE_ORDER.map(({ key, label }, i) => (
          <div key={key} data-testid={`sim-sub-${key}`}>
            <RadialScore
              label={label}
              value={result?.sub_scores[key] ?? 0}
              size="sm"
              animate={animate}
              delay={0.1 + i * 0.08}
            />
          </div>
        ))}
      </div>

      <p className="font-heading text-[10px] font-semibold uppercase tracking-widest text-ink-3">
        Only 4 of thousands of combinations are perfectly balanced
      </p>
    </div>
  );
}
