"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useReducedMotion } from "motion/react";
import { Countdown, ReconnectBanner, type ConnectionStatus } from "@/components/bidwave";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { getSimulationStatusAction, submitSimulationAttemptAction } from "@/app/app/simulation/actions";
import { SimulationResultPanel } from "@/app/app/simulation/simulation-result-panel";
import { useCrowdRoar } from "@/app/app/simulation/use-crowd-roar";

type Categorical = {
  key: string;
  label: string;
  default: string;
  order?: number;
  options: { key: string; label: string }[];
};
type SliderParam = { key: string; label: string; min: number; max: number; step: number; default: number; order?: number };
type Parameters = { categorical: Categorical[]; sliders: SliderParam[] };
type Attempt = { id: string; overall: number; success: boolean; sub_scores: Record<string, number>; winner_rank: number | null; server_ts: string };

const AUDIO_PREF_KEY = "bidwave.sim.audio";

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
  const [isFreshSubmission, setIsFreshSubmission] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>(history);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("online");
  const [audioOn, setAudioOn] = useState(false);
  const reduceMotion = useReducedMotion();
  const { prime, play } = useCrowdRoar();

  // Reads the saved audio preference after mount only — localStorage isn't
  // available during SSR, and reading it during the initial client render
  // would risk a hydration mismatch the same way an unguarded
  // useReducedMotion() read would (see page-transition.tsx).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAudioOn(window.localStorage.getItem(AUDIO_PREF_KEY) === "1");
  }, []);

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

  function toggleAudio() {
    const next = !audioOn;
    setAudioOn(next);
    window.localStorage.setItem(AUDIO_PREF_KEY, next ? "1" : "0");
  }

  async function handleAnalyze() {
    // Must run synchronously, before the `await` below, or the browser's
    // autoplay policy blocks AudioContext creation/resume entirely — see
    // use-crowd-roar.ts.
    if (audioOn && !reduceMotion) prime();

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
    setIsFreshSubmission(true);
    setAttempts((a) => [attempt, ...a]);
    setCooldownUntil(new Date(Date.now() + submitCooldownSeconds * 1000).toISOString());
    if (attempt.success && audioOn && !reduceMotion) play();
    toast.success(attempt.success ? "Combination submitted — a winning formula!" : "Combination submitted.");
  }

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
        {[...parameters.categorical].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((param) => (
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
        {[...parameters.sliders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((s) => (
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

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={audioOn}
          disabled={reduceMotion === true}
          onClick={toggleAudio}
          title={reduceMotion ? "Disabled by your system's reduced-motion setting." : undefined}
          className="cursor-pointer text-xs text-ink-3 underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Crowd audio: {reduceMotion ? "off (reduced motion)" : audioOn ? "on" : "off"}
        </button>
      </div>

      <Button onClick={handleAnalyze} disabled={!isActive || submitting} size="lg" className="w-full">
        {submitting ? "Analyzing…" : "ANALYZE"}
      </Button>

      {cooldownUntil && (
        <p className="text-center text-xs text-ink-3">
          Next attempt in <Countdown target={cooldownUntil} serverNowAtMount={new Date().toISOString()} expiredLabel="ready" />
        </p>
      )}

      <SimulationResultPanel result={lastResult} isFreshSubmission={isFreshSubmission} />

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
