"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { adminPublishLeaderboard, adminHideLeaderboard } from "@/app/admin/leaderboard/actions";

// Any server-rendered toLocaleString call needs an explicit locale/options
// — a zero-arg call produced a real hydration mismatch elsewhere in this
// codebase (console-sales-log.tsx), reproduced here during Phase 5 testing.
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

type Team = { id: string; name: string };
type LiveSnapshot = {
  id: string;
  published_at: string;
  covers_label: string | null;
  leaderboard_snapshot_entries: { rank: number; team_name: string; score: number }[];
} | null;

export function LeaderboardPublisher({
  kind,
  label,
  entryLimit,
  teams,
  live,
}: {
  kind: "top_15" | "final_top_10";
  label: string;
  entryLimit: number;
  teams: Team[];
  live: LiveSnapshot;
}) {
  const [rows, setRows] = useState<{ teamId: string; score: string }[]>(
    Array.from({ length: entryLimit }, () => ({ teamId: "", score: "" })),
  );
  const [coversLabel, setCoversLabel] = useState(live?.covers_label ?? "");
  const queryClient = useQueryClient();

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">{label}</h2>
        {live && (
          <Button
            size="sm"
            variant="tile"
            onClick={async () => {
              await adminHideLeaderboard(live.id);
              toast.success("Leaderboard hidden.");
              queryClient.invalidateQueries({ queryKey: ["admin", "leaderboard"] });
            }}
          >
            Hide current
          </Button>
        )}
      </div>

      {live ? (
        <div className="space-y-1 text-sm">
          <p className="text-xs text-ink-3">
            {live.covers_label ? `${live.covers_label} · ` : ""}
            Published {formatTimestamp(live.published_at)}
          </p>
          <ol className="list-decimal space-y-0.5 pl-5">
            {live.leaderboard_snapshot_entries
              .sort((a, b) => a.rank - b.rank)
              .map((e) => (
                <li key={e.rank}>
                  {e.team_name} — <span className="font-mono tabular-nums">{e.score}</span>
                </li>
              ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-ink-2">Nothing published.</p>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">
          Publish a new ranked list ({entryLimit} entries, admin-ordered)
        </p>
        <div className="space-y-1">
          {/* Shown publicly under the heading. Without it the public page can
              only say "Standings" and a viewer can't tell which rounds are
              counted — the whole reason covers_label exists. */}
          <label htmlFor={`covers-${kind}`} className="text-xs text-ink-2">
            What this covers — shown to the public
          </label>
          <Input
            id={`covers-${kind}`}
            className="w-full max-w-sm"
            placeholder="After Rounds 1 + 2"
            value={coversLabel}
            onChange={(e) => setCoversLabel(e.target.value)}
          />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 font-mono text-xs tabular-nums text-ink-3">{i + 1}</span>
            <Select
              value={row.teamId}
              onValueChange={(v) =>
                v && setRows((r) => r.map((x, j) => (j === i ? { ...x, teamId: v } : x)))
              }
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              step="0.01"
              className="w-28"
              placeholder="Score"
              value={row.score}
              onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, score: e.target.value } : x)))}
            />
          </div>
        ))}
        <Button
          size="sm"
          onClick={async () => {
            const entries = rows
              .filter((r) => r.teamId)
              .map((r, i) => ({
                rank: i + 1,
                team_name: teams.find((t) => t.id === r.teamId)?.name ?? "",
                score: Number(r.score) || 0,
              }));
            const result = await adminPublishLeaderboard(kind, entries, entryLimit, coversLabel);
            if (result.error) {
              toast.error(result.error);
            } else {
              toast.success("Leaderboard published.");
              queryClient.invalidateQueries({ queryKey: ["admin", "leaderboard"] });
            }
          }}
        >
          Publish
        </Button>
      </div>
    </div>
  );
}
