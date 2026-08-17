"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/bidwave";
import {
  adminSaveSimulationConfig,
  adminSetSimulationLifecycle,
  adminConfirmSimulationReward,
  adminRestartSimulation,
  adminReverseSimulationReward,
  adminRevealAnswerKey,
  adminRegenerateAnswerKeys,
  type SimActionState,
} from "@/app/admin/simulation/actions";

const simActionInitialState: SimActionState = { status: "idle" };

// Any server-rendered toLocaleString call needs an explicit locale/options
// — a zero-arg call produced a real hydration mismatch elsewhere in this
// codebase (console-sales-log.tsx), reproduced in this file's sibling
// (announcement-panel.tsx) during Phase 5 testing.
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

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type Config = {
  id: string;
  updated_at: string;
  parameters: unknown;
  scoring: unknown;
  global_timer_seconds: number;
  submit_cooldown_seconds: number;
  started_at: string | null;
  stopped_at: string | null;
  visible_at: string | null;
  winner_count: number;
  max_winners: number;
} | null;

type Attempt = { id: string; team_id: string; team_name: string; overall: number; success: boolean; winner_rank: number | null; server_ts: string };
type Round = { id: string; title: string };
type Team = { id: string; name: string };
type Reward = {
  id: string;
  team_id: string;
  team_name: string;
  reward_kind: "marks" | "purse";
  amount: number;
  target_round_id: string | null;
  purse_applied_at: string | null;
};

export function SimulationAdmin({
  config,
  attempts,
  rounds,
  teams,
  rewards,
}: {
  config: Config;
  attempts: Attempt[];
  rounds: Round[];
  teams: Team[];
  rewards: Reward[];
}) {
  const [state, formAction, isPending] = useActionState(adminSaveSimulationConfig, simActionInitialState);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (state.status === "success") {
      toast.success("Simulation configuration saved.");
      queryClient.invalidateQueries({ queryKey: ["admin", "simulation"] });
    }
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state, queryClient]);
  const [rewardTeam, setRewardTeam] = useState("");
  const [rewardKind, setRewardKind] = useState<"marks" | "purse">("marks");
  const [rewardAmount, setRewardAmount] = useState("");
  const [rewardRound, setRewardRound] = useState("");
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [reversing, setReversing] = useState<Reward | null>(null);

  return (
    <div className="space-y-8">
      {config && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
          <div className="text-sm">
            <p>
              Winners so far: <span className="font-mono">{config.winner_count}</span> / {config.max_winners}
            </p>
            <p className="text-xs text-ink-3">
              {config.started_at ? `Started ${formatTimestamp(config.started_at)}` : "Not started"}
              {config.stopped_at && ` · Stopped ${formatTimestamp(config.stopped_at)}`}
            </p>
            {/* C2: visibility is independent of started_at/stopped_at — a
                stopped simulation isn't automatically hidden again, and a
                not-yet-started one isn't automatically visible. */}
            <p className="text-xs text-ink-3">
              {config.visible_at ? "Visible to teams" : "Hidden from teams"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  setLifecycleError(null);
                  const { error } = await adminSetSimulationLifecycle(config.id, "start");
                  if (error) {
                    setLifecycleError(error);
                    toast.error(error);
                  } else {
                    toast.success("Simulation started.");
                    queryClient.invalidateQueries({ queryKey: ["admin", "simulation"] });
                  }
                }}
                disabled={!!config.started_at}
              >
                Start
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setLifecycleError(null);
                  const { error } = await adminSetSimulationLifecycle(config.id, "stop");
                  if (error) {
                    setLifecycleError(error);
                    toast.error(error);
                  } else {
                    toast.success("Simulation stopped.");
                    queryClient.invalidateQueries({ queryKey: ["admin", "simulation"] });
                  }
                }}
                disabled={!!config.stopped_at}
              >
                Stop
              </Button>
              {config.stopped_at && (
                <Button size="sm" variant="outline" onClick={() => setRestarting(true)}>
                  Restart…
                </Button>
              )}
              {!config.started_at && (
                <Button size="sm" variant="outline" onClick={() => setRegenerating(true)}>
                  Regenerate keys…
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setLifecycleError(null);
                  const action = config.visible_at ? "hide" : "reveal";
                  const { error } = await adminSetSimulationLifecycle(config.id, action);
                  if (error) {
                    setLifecycleError(error);
                    toast.error(error);
                  } else {
                    toast.success(action === "reveal" ? "Simulation revealed to teams." : "Simulation hidden from teams.");
                    queryClient.invalidateQueries({ queryKey: ["admin", "simulation"] });
                  }
                }}
              >
                {config.visible_at ? "Hide from teams" : "Show to teams"}
              </Button>
            </div>
            {lifecycleError && <p className="text-xs text-unsold">{lifecycleError}</p>}
          </div>
        </div>
      )}

      <form action={formAction} className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
          Configuration (parameters / scoring / answer key — JSON, config not code)
        </h2>
        <input type="hidden" name="configId" value={config?.id ?? ""} />
        <input type="hidden" name="expectedUpdatedAt" value={config?.updated_at ?? ""} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sim-timer">Global timer (seconds)</Label>
            <Input id="sim-timer" name="globalTimerSeconds" type="number" defaultValue={config?.global_timer_seconds ?? 1500} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sim-cooldown">Submit cooldown (seconds)</Label>
            <Input id="sim-cooldown" name="submitCooldownSeconds" type="number" defaultValue={config?.submit_cooldown_seconds ?? 3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sim-max-winners">Max winners (1–4, capped by the 4 generated keys)</Label>
            <Input
              id="sim-max-winners"
              name="maxWinners"
              type="number"
              min={1}
              max={4}
              defaultValue={config?.max_winners ?? 2}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sim-parameters">Parameters (public-safe)</Label>
          <Textarea
            id="sim-parameters"
            name="parameters"
            rows={8}
            className="font-mono text-xs"
            defaultValue={config ? JSON.stringify(config.parameters, null, 2) : ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sim-scoring">Scoring (private)</Label>
          <Textarea
            id="sim-scoring"
            name="scoring"
            rows={8}
            className="font-mono text-xs"
            defaultValue={config ? JSON.stringify(config.scoring, null, 2) : ""}
          />
        </div>
        <AnswerKeyField configId={config?.id ?? null} />

        {state.status === "error" && state.formError && <p className="text-sm text-unsold">{state.formError}</p>}
        {state.status === "success" && <p className="text-sm text-sold">Saved — calibration passed (all-defaults = 70).</p>}
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save configuration"}
        </Button>
      </form>

      <div className="space-y-2">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
          Live attempt feed (admin only)
        </h2>
        {attempts.length === 0 ? (
          <p className="text-sm text-ink-2">No attempts yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {attempts.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                <span>
                  {a.team_name} — {a.overall}
                  {a.winner_rank && <StatusPill status="qualified" label={`Winner ${a.winner_rank}`} className="ml-2" />}
                </span>
                <span className="text-xs text-ink-3">{formatTime(a.server_ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {config && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
            Confirm reward (SIM-11)
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={rewardTeam} onValueChange={(v) => v && setRewardTeam(v)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={rewardKind} onValueChange={(v) => v && setRewardKind(v as typeof rewardKind)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="marks">Marks</SelectItem>
                <SelectItem value="purse">Purse</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="w-28"
              type="number"
              placeholder="Amount"
              value={rewardAmount}
              onChange={(e) => setRewardAmount(e.target.value)}
            />
            {rewardKind === "marks" && (
              <Select value={rewardRound} onValueChange={(v) => v && setRewardRound(v)}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Target round" />
                </SelectTrigger>
                <SelectContent>
                  {rounds.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              size="sm"
              onClick={async () => {
                setRewardError(null);
                const { error } = await adminConfirmSimulationReward(
                  config.id,
                  rewardTeam,
                  null,
                  rewardKind,
                  Number(rewardAmount) || 0,
                  rewardKind === "marks" ? rewardRound || null : null,
                  "Simulation winner reward",
                );
                if (error) {
                  setRewardError(error);
                  toast.error(error);
                } else {
                  toast.success("Reward confirmed.");
                  queryClient.invalidateQueries({ queryKey: ["admin", "simulation"] });
                  setRewardTeam("");
                  setRewardAmount("");
                  setRewardRound("");
                }
              }}
              disabled={!rewardTeam || !rewardAmount}
            >
              Confirm
            </Button>
          </div>
          {rewardError && <p className="mt-2 text-xs text-unsold">{rewardError}</p>}

          {rewards.length > 0 && (
            <ul className="space-y-1 border-t border-border pt-3">
              {rewards.map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
                  <span>
                    {r.team_name} — {r.reward_kind} {r.amount}
                    {r.reward_kind === "purse" && (
                      <span className="ml-2 text-xs text-ink-3">
                        {r.purse_applied_at ? "applied" : "pending purse apply"}
                      </span>
                    )}
                  </span>
                  <Button size="sm" variant="tile" onClick={() => setReversing(r)}>
                    Reverse…
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {config && (
        <RestartDialog
          configId={config.id}
          open={restarting}
          onOpenChange={setRestarting}
        />
      )}
      {config && (
        <RegenerateKeysDialog
          configId={config.id}
          open={regenerating}
          onOpenChange={setRegenerating}
        />
      )}
      <ReverseRewardDialog
        configId={config?.id ?? ""}
        reward={reversing}
        onOpenChange={(open) => !open && setReversing(null)}
      />
    </div>
  );
}

// getSimulationData() never ships answer_key to the browser (it's
// generated at seed time and lives only in the DB — plan spec, see
// 20260807100000_simulation_spec_conformance.sql). This starts collapsed;
// "Reveal" fetches it on demand, and the hidden field falls back to the
// config's current key server-side when left untouched (adminSaveSimulation
// Config in actions.ts) so a routine save (e.g. tweaking the timer) can't
// silently wipe it.
function AnswerKeyField({ configId }: { configId: string | null }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor="sim-answer-key">Answer key (the 4 correct combinations — service_role only)</Label>
        {configId && revealed === null && (
          <Button
            type="button"
            size="sm"
            variant="tile"
            disabled={revealing}
            onClick={async () => {
              setRevealing(true);
              const { answerKey, error } = await adminRevealAnswerKey(configId);
              setRevealing(false);
              if (error) {
                toast.error(error);
                return;
              }
              setRevealed(JSON.stringify(answerKey, null, 2));
            }}
          >
            {revealing ? "Revealing…" : "Reveal answer key"}
          </Button>
        )}
      </div>
      <Textarea
        id="sim-answer-key"
        name="answerKey"
        rows={6}
        className="font-mono text-xs"
        placeholder={configId ? "Hidden — click \"Reveal answer key\" to view or edit. Leave blank to keep it unchanged." : ""}
        defaultValue={revealed ?? ""}
        key={revealed ?? "hidden"}
      />
    </div>
  );
}

// Regenerating mid-round would invalidate any already-confirmed winner's
// actual submitted combination — the RPC itself refuses once started_at is
// set (20260807100000), this dialog only appears before that point.
function RegenerateKeysDialog({
  configId,
  open,
  onOpenChange,
}: {
  configId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate answer keys</DialogTitle>
          <DialogDescription>
            Generates 4 new championship formulas and replaces the current answer key. Only available before the
            simulation starts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="regen-reason">Reason (required)</Label>
          <Textarea
            id="regen-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. suspected leak during rehearsal"
          />
        </div>

        {error && <p className="text-sm text-unsold">{error}</p>}

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={reason.trim().length === 0 || isPending}
            onClick={async () => {
              setIsPending(true);
              setError(null);
              const { error } = await adminRegenerateAnswerKeys(configId, reason.trim());
              setIsPending(false);
              if (error) {
                setError(error);
                toast.error(error);
                return;
              }
              toast.success("Answer keys regenerated.");
              queryClient.invalidateQueries({ queryKey: ["admin", "simulation"] });
              setReason("");
              onOpenChange(false);
            }}
          >
            {isPending ? "Regenerating…" : "Confirm regeneration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// E2: reason-required, mirrors the round-reopen dialog — restarting after
// a stop is a deliberate, audited exception, not a routine action.
function RestartDialog({
  configId,
  open,
  onOpenChange,
}: {
  configId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restart simulation</DialogTitle>
          <DialogDescription>
            Starts a fresh timer window. Past attempts stay on record — nothing is deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="restart-reason">Reason (required)</Label>
          <Textarea
            id="restart-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. stopped too early by mistake"
          />
        </div>

        {error && <p className="text-sm text-unsold">{error}</p>}

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={reason.trim().length === 0 || isPending}
            onClick={async () => {
              setIsPending(true);
              setError(null);
              const { error } = await adminRestartSimulation(configId, reason.trim());
              setIsPending(false);
              if (error) {
                setError(error);
                toast.error(error);
                return;
              }
              toast.success("Simulation restarted.");
              queryClient.invalidateQueries({ queryKey: ["admin", "simulation"] });
              setReason("");
              onOpenChange(false);
            }}
          >
            {isPending ? "Restarting…" : "Confirm restart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// E3: undo a marks/purse reward grant.
function ReverseRewardDialog({
  configId,
  reward,
  onOpenChange,
}: {
  configId: string;
  reward: Reward | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  return (
    <Dialog open={!!reward} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse reward</DialogTitle>
          <DialogDescription>
            {reward &&
              `${reward.team_name}'s ${reward.reward_kind} reward (${reward.amount}) will be removed${
                reward.reward_kind === "purse" && reward.purse_applied_at ? " and the purse debited back." : "."
              }`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="reverse-reward-reason">Reason (required)</Label>
          <Textarea
            id="reverse-reward-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. granted to the wrong team"
          />
        </div>

        {error && <p className="text-sm text-unsold">{error}</p>}

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={reason.trim().length === 0 || isPending || !reward}
            onClick={async () => {
              if (!reward) return;
              setIsPending(true);
              setError(null);
              const { error } = await adminReverseSimulationReward(configId, reward.team_id, reason.trim());
              setIsPending(false);
              if (error) {
                setError(error);
                toast.error(error);
                return;
              }
              toast.success("Reward reversed.");
              queryClient.invalidateQueries({ queryKey: ["admin", "simulation"] });
              setReason("");
              onOpenChange(false);
            }}
          >
            {isPending ? "Reversing…" : "Confirm reversal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
