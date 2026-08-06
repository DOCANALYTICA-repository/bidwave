"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getStageStandings,
  adminConfirmQualifications,
  adminSetStageRounds,
} from "@/app/admin/stages/actions";

type Standing = { team_id: string; team_name: string; aggregate: number; rank: number };
type RoundOption = { id: string; title: string; kind: string; sequence: number };
type RoundWeight = { round_id: string; weight: number };

export function StagePanel({
  stageId,
  label,
  rounds,
  initialRoundWeights,
  refreshSignal,
}: {
  stageId: string;
  label: string;
  rounds: RoundOption[];
  initialRoundWeights: RoundWeight[];
  /** Bumped by the 'stages' broadcast_live() topic (see stages-live.tsx) to
   * re-run the standings fetch below in step with other admins' changes —
   * a dependency on the effect, not a remount key, so it doesn't wipe an
   * admin's in-progress (unsaved) qualification-decision selections. */
  refreshSignal?: number;
}) {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    getStageStandings(stageId).then((rows) => {
      setStandings(rows as Standing[]);
      setLoading(false);
    });
  }, [stageId, refreshSignal]);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">{label}</h2>
        <Button
          size="sm"
          onClick={async () => {
            setConfirmError(null);
            const decisionList = standings.map((s) => ({
              team_id: s.team_id,
              decision: decisions[s.team_id] ?? "pending",
            }));
            const { error } = await adminConfirmQualifications(stageId, decisionList);
            if (error) setConfirmError(error);
            else queryClient.invalidateQueries({ queryKey: ["admin", "stages"] });
          }}
        >
          Confirm qualifications
        </Button>
      </div>
      {confirmError && <p className="text-xs text-unsold">{confirmError}</p>}

      <ContributingRounds stageId={stageId} rounds={rounds} initialRoundWeights={initialRoundWeights} />

      {loading ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : standings.length === 0 ? (
        <p className="text-sm text-ink-2">No scored rounds contribute to this stage yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1 text-xs uppercase text-ink-2">Rank</th>
              <th className="px-2 py-1 text-xs uppercase text-ink-2">Team</th>
              <th className="px-2 py-1 text-xs uppercase text-ink-2">Aggregate</th>
              <th className="px-2 py-1 text-xs uppercase text-ink-2">Decision</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => (
              <tr key={s.team_id} className="border-t border-border">
                <td className="px-2 py-1 font-mono tabular-nums">{s.rank}</td>
                <td className="px-2 py-1">{s.team_name}</td>
                <td className="px-2 py-1 font-mono tabular-nums">{s.aggregate}</td>
                <td className="px-2 py-1">
                  <Select
                    value={decisions[s.team_id] ?? "pending"}
                    onValueChange={(v) => v && setDecisions((d) => ({ ...d, [s.team_id]: v }))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="eliminated">Eliminated</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * admin_set_stage_rounds() has existed since Phase 3 but had no UI anywhere
 * — this is the one genuinely new admin surface Round 6 needs (R6-04:
 * wiring the conference round into r6's stage_rounds, and specifically
 * never into final's, is what keeps its score standalone). Benefits every
 * stage, not just r6. Full-replace semantics match the RPC: it deletes and
 * re-inserts the whole set for this stage on every save.
 */
function ContributingRounds({
  stageId,
  rounds,
  initialRoundWeights,
}: {
  stageId: string;
  rounds: RoundOption[];
  initialRoundWeights: RoundWeight[];
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialRoundWeights.map((rw) => [rw.round_id, true])),
  );
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialRoundWeights.map((rw) => [rw.round_id, String(rw.weight)])),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  return (
    <details className="rounded-lg border border-border/60 bg-surface-2/40 p-3">
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-ink-2">
        Contributing rounds
      </summary>
      <div className="mt-3 space-y-2">
        {rounds.length === 0 ? (
          <p className="text-sm text-ink-2">No rounds exist yet.</p>
        ) : (
          rounds.map((r) => (
            <label key={r.id} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={selected[r.id] ?? false}
                onChange={(e) => setSelected((s) => ({ ...s, [r.id]: e.target.checked }))}
              />
              <span className="flex-1">
                {r.title} <span className="text-xs text-ink-3">({r.kind})</span>
              </span>
              <Input
                type="number"
                step="0.001"
                className="w-20"
                value={weights[r.id] ?? "1"}
                disabled={!selected[r.id]}
                onChange={(e) => setWeights((w) => ({ ...w, [r.id]: e.target.value }))}
              />
            </label>
          ))
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={isSaving}
          onClick={async () => {
            setIsSaving(true);
            setSaved(false);
            setSaveError(null);
            const roundWeights = rounds
              .filter((r) => selected[r.id])
              .map((r) => ({ round_id: r.id, weight: Number(weights[r.id] ?? 1) }));
            const { error } = await adminSetStageRounds(stageId, roundWeights);
            setIsSaving(false);
            if (error) {
              setSaveError(error);
            } else {
              setSaved(true);
              queryClient.invalidateQueries({ queryKey: ["admin", "stages"] });
            }
          }}
        >
          {isSaving ? "Saving…" : "Save contributing rounds"}
        </Button>
        {saved && <span className="ml-2 text-xs text-sold">Saved.</span>}
        {saveError && <span className="ml-2 text-xs text-unsold">{saveError}</span>}
      </div>
    </details>
  );
}
