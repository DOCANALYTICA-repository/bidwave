"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Countdown, StatTile, ReconnectBanner, type ConnectionStatus } from "@/components/bidwave";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { getSimulationStatusAction, submitSimulationAttemptAction } from "@/app/app/simulation/actions";

type Categorical = { key: string; label: string; default: string; options: { key: string; label: string }[] };
type SliderParam = { key: string; label: string; min: number; max: number; step: number; default: number };
type Parameters = { categorical: Categorical[]; sliders: SliderParam[] };
type Attempt = { id: string; overall: number; success: boolean; sub_scores: Record<string, number>; winner_rank: number | null; server_ts: string };

const SUB_SCORE_LABELS: Record<string, string> = {
  batting: "BATTING",
  bowling: "BOWLING",
  leadership: "LEADERSHIP",
  fielding: "FIELDING",
  bench: "BENCH",
  chemistry: "CHEMISTRY",
};

export function SimulationConsole({
  configId,
  parameters,
  submitCooldownSeconds,
  history,
}: {
  configId: string;
  parameters: Parameters;
  submitCooldownSeconds: number;
  history: Attempt[];
}) {
  const [status, setStatus] = useState<{ status: string; ends_at: string | null; winner_count: number } | null>(null);
  const [categorical, setCategorical] = useState<Record<string, string>>(() =>
    Object.fromEntries(parameters.categorical.map((c) => [c.key, c.default])),
  );
  const [sliders, setSliders] = useState<Record<string, number>>(() =>
    Object.fromEntries(parameters.sliders.map((s) => [s.key, s.default])),
  );
  const [lastResult, setLastResult] = useState<Attempt | null>(history[0] ?? null);
  const [attempts, setAttempts] = useState<Attempt[]>(history);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("online");

  useEffect(() => {
    let cancelled = false;
    let failures = 0;
    async function poll() {
      // No push channel here either — polling is the only signal, so a
      // dropped connection needs to surface the same way the quiz runner's
      // does (ERR-08, NFR-05), not stall silently.
      try {
        const res = await getSimulationStatusAction(configId);
        if (cancelled) return;
        if (!res.data) return;
        failures = 0;
        setConnectionStatus("online");
        setStatus(res.data as never);
      } catch {
        if (cancelled) return;
        failures += 1;
        setConnectionStatus(failures >= 3 ? "offline" : "reconnecting");
      }
    }
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [configId]);

  const isActive = status?.status === "active";

  async function handleAnalyze() {
    setSubmitting(true);
    setError(null);
    const res = await submitSimulationAttemptAction(configId, { categorical, sliders });
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    // submit_simulation_attempt() returns attempt_id/overall/success/
    // winner_rank/sub_scores — not the same shape as a row read back from
    // simulation_attempts (id/server_ts) — map it explicitly rather than
    // casting, or history entries silently get an undefined id/server_ts.
    const raw = res.data as {
      attempt_id: string;
      overall: number;
      success: boolean;
      sub_scores: Record<string, number>;
      winner_rank: number | null;
    };
    const attempt: Attempt = {
      id: raw.attempt_id,
      overall: raw.overall,
      success: raw.success,
      sub_scores: raw.sub_scores,
      winner_rank: raw.winner_rank,
      server_ts: new Date().toISOString(),
    };
    setLastResult(attempt);
    setAttempts((a) => [attempt, ...a]);
    setCooldownUntil(new Date(Date.now() + submitCooldownSeconds * 1000).toISOString());
    toast.success(attempt.success ? "Combination submitted — a winning formula!" : "Combination submitted.");
  }

  const subScoreEntries = useMemo(
    () => (lastResult ? Object.entries(lastResult.sub_scores) : []),
    [lastResult],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <ReconnectBanner status={connectionStatus} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl">On-spot simulation</h1>
          <p className="text-xs text-ink-3">
            {status?.status === "not_started" && "Waiting for admin to start."}
            {status?.status === "active" && status.ends_at && (
              <>
                Time remaining:{" "}
                <Countdown target={status.ends_at} serverNowAtMount={new Date().toISOString()} className="text-gold" />
              </>
            )}
            {status?.status === "stopped" && "The simulation has ended."}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {parameters.categorical.map((param) => (
          <div key={param.key} className="space-y-1.5">
            <p className="font-heading text-xs font-semibold uppercase tracking-wide text-ink-2">{param.label}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {param.options.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  disabled={!isActive}
                  onClick={() => setCategorical((c) => ({ ...c, [param.key]: opt.key }))}
                  className={`cursor-pointer rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    categorical[param.key] === opt.key
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border bg-card hover:border-gold/40"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {parameters.sliders.map((s) => (
          <div key={s.key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="font-heading text-xs font-semibold uppercase tracking-wide text-ink-2">{s.label}</p>
              <span className="font-mono text-sm tabular-nums text-ink-2">{sliders[s.key]}</span>
            </div>
            <Slider
              min={s.min}
              max={s.max}
              step={s.step}
              value={sliders[s.key]}
              disabled={!isActive}
              onValueChange={(v) => setSliders((cur) => ({ ...cur, [s.key]: v as number }))}
            />
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-unsold">{error}</p>}

      <Button onClick={handleAnalyze} disabled={!isActive || submitting} size="lg" className="w-full">
        {submitting ? "Analyzing…" : "ANALYZE"}
      </Button>

      {cooldownUntil && (
        <p className="text-center text-xs text-ink-3">
          Next attempt in <Countdown target={cooldownUntil} serverNowAtMount={new Date().toISOString()} expiredLabel="ready" />
        </p>
      )}

      {lastResult && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-6 text-center">
          <p
            className={`font-heading text-sm font-semibold uppercase tracking-wide ${
              lastResult.success ? "text-sold" : "text-ink-2"
            }`}
          >
            {lastResult.success ? "STAR PLAYER" : "AWAITING FORMULA"}
            {lastResult.winner_rank && ` · Winner rank ${lastResult.winner_rank}`}
          </p>
          <p className="font-mono text-4xl font-bold tabular-nums text-gold">{lastResult.overall}</p>
          {!lastResult.success && (
            <p className="text-sm text-ink-2">
              This combination is not one of the four championship formulas. Recalibrate and try again.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {subScoreEntries.map(([key, value]) => (
              <StatTile key={key} label={SUB_SCORE_LABELS[key] ?? key} value={value} />
            ))}
          </div>
        </div>
      )}

      {attempts.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
            Your attempt history
          </h2>
          <ul className="space-y-1 text-sm text-ink-2">
            {attempts.map((a) => (
              <li key={a.id} className="flex justify-between">
                {/* toLocaleTimeString() with no explicit locale/options
                   renders differently server (Node's default locale) vs.
                   client (the browser's) for this server-rendered client
                   component — the same hydration-mismatch bug class
                   already fixed once in console-sales-log.tsx. */}
                <span>
                  {new Date(a.server_ts).toLocaleTimeString("en-IN", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className="font-mono tabular-nums">{a.overall}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
