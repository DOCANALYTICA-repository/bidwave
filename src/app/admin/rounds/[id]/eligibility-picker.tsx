"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/bidwave";
import {
  adminSetRoundEligibility,
  adminAddRoundEligibleTeam,
  adminRemoveRoundEligibleTeam,
} from "@/app/admin/rounds/actions";

export type EligibilityTeamRow = {
  id: string;
  name: string;
  /** Status of this team's attempt at the SUPERSEDED round, if any. */
  priorStatus: string | null;
  priorReason: string | null;
  priorScore: number | null;
  priorMax: number | null;
  priorCorrect: number | null;
  priorQuestions: number | null;
  eligible: boolean;
  /** True once the team has started an attempt at THIS round. */
  hasAttempt: boolean;
};

/**
 * Who gets the re-attempt is an admin decision, not a query — a team that
 * finished cleanly but reported a stuck question belongs on the list, and a
 * no-show does not, and no attempt-outcome heuristic distinguishes those.
 * So nothing here is pre-selected. The prior-round columns and the reason
 * filter exist purely to make the manual decision fast: they change what
 * you are LOOKING at, never what is selected.
 */
export function EligibilityPicker({
  roundId,
  teams,
  supersededRoundTitle,
  roundIsOpen,
}: {
  roundId: string;
  teams: EligibilityTeamRow[];
  supersededRoundTitle: string | null;
  roundIsOpen: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(teams.filter((t) => t.eligible).map((t) => t.id)),
  );
  const [query, setQuery] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [pending, startTransition] = useTransition();

  const reasons = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) set.add(t.priorReason ?? (t.priorStatus ? t.priorStatus : "no attempt"));
    return Array.from(set).sort();
  }, [teams]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q)) return false;
      if (reasonFilter === "all") return true;
      const key = t.priorReason ?? (t.priorStatus ? t.priorStatus : "no attempt");
      return key === reasonFilter;
    });
  }, [teams, query, reasonFilter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const res = await adminSetRoundEligibility(roundId, Array.from(selected));
      if (res.ok) toast.success(`${res.count} team(s) can take this round.`);
      else toast.error(res.error);
    });
  }

  function addOne(teamId: string) {
    startTransition(async () => {
      const res = await adminAddRoundEligibleTeam(roundId, teamId);
      if (res.ok) {
        setSelected((prev) => new Set(prev).add(teamId));
        toast.success("Team added.");
      } else toast.error(res.error);
    });
  }

  function removeOne(teamId: string) {
    startTransition(async () => {
      const res = await adminRemoveRoundEligibleTeam(roundId, teamId);
      if (res.ok) {
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(teamId);
          return next;
        });
        toast.success("Team removed.");
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-ink-2">
        <p>
          Only the teams ticked here can start this round.{" "}
          {supersededRoundTitle ? (
            <>
              Their score will replace their <strong>{supersededRoundTitle}</strong> score in the
              stage total — including if it is lower.
            </>
          ) : (
            <>This round does not currently replace another round&apos;s score.</>
          )}
        </p>
        <p className="mt-2 text-ink-3">
          Nothing is pre-selected. The filters below only change what you can see, never who is
          selected.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by team name"
          className="max-w-xs"
        />
        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
        >
          <option value="all">All outcomes</option>
          {reasons.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <span className="text-sm text-ink-2">
          {selected.size} of {teams.length} teams selected
        </span>
        <div className="ml-auto">
          {roundIsOpen ? (
            // Bulk save is delete-then-insert; with the round live and two
            // admins on the console, one save would silently drop the
            // other's walk-up additions. Per-row Add/Remove only.
            <p className="text-xs text-ink-3">
              Round is open — use Add/Remove per team.
            </p>
          ) : (
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save eligibility list"}
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-surface-2">
              <th className="px-3 py-2 text-xs font-semibold uppercase text-ink-2">Eligible</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase text-ink-2">Team</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase text-ink-2">
                {supersededRoundTitle ?? "Prior round"} outcome
              </th>
              <th className="px-3 py-2 text-xs font-semibold uppercase text-ink-2">Prior score</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase text-ink-2">This round</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-3 py-2">
                  {roundIsOpen ? (
                    selected.has(t.id) ? (
                      <Button
                        size="xs"
                        variant="tile"
                        disabled={pending || t.hasAttempt}
                        onClick={() => removeOne(t.id)}
                      >
                        Remove
                      </Button>
                    ) : (
                      <Button size="xs" variant="tile" disabled={pending} onClick={() => addOne(t.id)}>
                        Add
                      </Button>
                    )
                  ) : (
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggle(t.id)}
                      aria-label={`Allow ${t.name} to take this round`}
                      className="size-4 accent-gold"
                    />
                  )}
                </td>
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2 text-ink-2">
                  {t.priorStatus === null
                    ? "never started"
                    : (t.priorReason ?? t.priorStatus)}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-ink-2">
                  {t.priorScore != null && t.priorMax != null ? (
                    <>
                      {t.priorScore} / {t.priorMax}
                      {t.priorCorrect != null && t.priorQuestions != null && (
                        <span className="ml-2 text-xs text-ink-3">
                          ({t.priorCorrect}/{t.priorQuestions} correct)
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {t.hasAttempt ? (
                    <StatusPill status="submitted" label="attempt started" />
                  ) : (
                    <span className="text-xs text-ink-3">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
