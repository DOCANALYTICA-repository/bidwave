"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, Money } from "@/components/bidwave";

type StatDef = { key: string; label: string; data_type: string };
type Player = {
  id: string;
  full_name: string;
  role: string;
  pool: string;
  base_price: number;
  status: string;
  stats: Record<string, unknown> | null;
};

/**
 * Head-to-head comparison. Purely local UI state (no form submission), so
 * this stays a plain controlled Select — the name-prop/FormData gotcha
 * only applies inside a <form action={serverAction}>, which this isn't.
 */
export function PlayerCompare({ players, statDefs }: { players: Player[]; statDefs: StatDef[] }) {
  const [leftId, setLeftId] = useState<string>(players[0]?.id ?? "");
  const [rightId, setRightId] = useState<string>(players[1]?.id ?? "");

  if (players.length < 2) {
    return (
      <EmptyState
        title="Not enough players to compare"
        description="Head-to-head comparison needs at least two players in the pool."
      />
    );
  }

  const left = players.find((p) => p.id === leftId) ?? players[0];
  const right = players.find((p) => p.id === rightId) ?? players[1];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <PlayerPicker players={players} value={leftId} onChange={setLeftId} label="Player A" />
        <PlayerPicker players={players} value={rightId} onChange={setRightId} label="Player B" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="px-3 py-2 font-medium">Metric</th>
              <th className="px-3 py-2 font-medium">{left?.full_name ?? "—"}</th>
              <th className="px-3 py-2 font-medium">{right?.full_name ?? "—"}</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Role" a={left?.role} b={right?.role} />
            <Row label="Pool" a={left?.pool} b={right?.pool} />
            <Row
              label="Base price"
              a={left ? <Money value={left.base_price} /> : "—"}
              b={right ? <Money value={right.base_price} /> : "—"}
            />
            <Row label="Status" a={left?.status} b={right?.status} />
            {statDefs.map((def) => (
              <Row
                key={def.key}
                label={def.label}
                a={left?.stats?.[def.key] != null ? String(left.stats[def.key]) : "—"}
                b={right?.stats?.[def.key] != null ? String(right.stats[def.key]) : "—"}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, a, b }: { label: string; a: React.ReactNode; b: React.ReactNode }) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="px-3 py-2 text-ink-2">{label}</td>
      <td className="px-3 py-2">{a ?? "—"}</td>
      <td className="px-3 py-2">{b ?? "—"}</td>
    </tr>
  );
}

function PlayerPicker({
  players,
  value,
  onChange,
  label,
}: {
  players: Player[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <Select value={value} onValueChange={(next) => onChange(next ?? "")}>
        <SelectTrigger className="w-full">
          <SelectValue>
            {() => players.find((p) => p.id === value)?.full_name ?? "Select a player"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {players.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.full_name} · {p.role}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
