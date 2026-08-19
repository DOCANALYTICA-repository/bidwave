"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn, StatusPill } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { adminUpsertPlayer, type PlayerActionState } from "@/app/admin/auction/players/actions";
import { formatCrore } from "@/lib/auction/format";
import type { Database } from "@/lib/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];

// "use server" files can only export async functions — this initial-state
// literal has to live here on the client side.
const playerActionInitialState: PlayerActionState = { status: "idle" };

/**
 * The pool's status board. Ordered by the same 'POT nn · …' pool prefix the
 * import script assigns, so reading top to bottom is reading bidding order.
 */
const STATUS_FILTERS = ["all", "available", "unsold", "active", "recalled", "sold"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export function PlayersTable({
  players,
  teamLabels,
  eventEditionId,
  roundId,
}: {
  players: Player[];
  /** team_id -> franchise alias (falling back to registered name). */
  teamLabels: Record<string, string>;
  eventEditionId: string;
  roundId: string | null;
}) {
  const [editing, setEditing] = useState<Player | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: players.length };
    for (const p of players) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [players]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.full_name.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        p.pool.toLowerCase().includes(q) ||
        (p.ipl_team ?? "").toLowerCase().includes(q) ||
        (p.nationality ?? "").toLowerCase().includes(q) ||
        (p.current_team_id ? (teamLabels[p.current_team_id] ?? "").toLowerCase().includes(q) : false)
      );
    });
  }, [players, search, statusFilter, teamLabels]);

  const columns: DataTableColumn<Player>[] = [
    { key: "name", header: "Name", render: (p) => p.full_name },
    { key: "role", header: "Role", render: (p) => p.role },
    { key: "pool", header: "Pool", render: (p) => p.pool },
    {
      key: "base_price",
      header: "Base",
      render: (p) => <span className="font-mono tabular-nums">{formatCrore(p.base_price)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <StatusPill status={p.status} />,
    },
    {
      key: "sold_to",
      header: "Sold to",
      render: (p) =>
        p.current_team_id ? (
          <span>
            {teamLabels[p.current_team_id] ?? "—"}
            {p.sale_price != null && (
              <span className="ml-1 font-mono text-xs tabular-nums text-ink-3">{formatCrore(p.sale_price)}</span>
            )}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "overseas",
      header: "Overseas",
      render: (p) => (p.is_overseas ? "Yes" : "—"),
    },
    {
      key: "actions",
      header: "",
      render: (p) => (
        <Button variant="tile" size="sm" onClick={() => setEditing(p)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          {filteredPlayers.length} player{filteredPlayers.length === 1 ? "" : "s"}
          {(search.trim() || statusFilter !== "all") && ` of ${players.length}`}
        </h2>
        <Button size="sm" onClick={() => setEditing("new")}>
          Add player
        </Button>
      </div>
      <Input
        placeholder="Search by name, role, pool, franchise, IPL team or nationality…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
          >
            <span className="capitalize">{s}</span>
            <span className="ml-1.5 font-mono text-xs tabular-nums opacity-70">{counts[s] ?? 0}</span>
          </Button>
        ))}
      </div>
      <DataTable
        columns={columns}
        rows={filteredPlayers}
        rowKey={(p) => p.id}
        emptyTitle={players.length === 0 ? "No players yet" : "No players match this filter"}
        emptyDescription={
          players.length === 0
            ? "Import a CSV/XLSX file above, or add players individually."
            : undefined
        }
      />
      <Sheet open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          {editing && (
            <PlayerFormContent
              key={editing === "new" ? "new" : editing.id}
              player={editing === "new" ? null : editing}
              eventEditionId={eventEditionId}
              roundId={roundId}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PlayerFormContent({
  player,
  eventEditionId,
  roundId,
}: {
  player: Player | null;
  eventEditionId: string;
  roundId: string | null;
}) {
  const [state, formAction, isPending] = useActionState(adminUpsertPlayer, playerActionInitialState);

  useEffect(() => {
    if (state.status === "success") toast.success("Player saved.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state]);

  return (
    <>
      <SheetHeader>
        <SheetTitle>{player ? player.full_name : "Add player"}</SheetTitle>
      </SheetHeader>
      <form action={formAction} className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <input type="hidden" name="playerId" value={player?.id ?? ""} />
        <input type="hidden" name="expectedUpdatedAt" value={player?.updated_at ?? ""} />
        <input type="hidden" name="eventEditionId" value={eventEditionId} />
        <input type="hidden" name="roundId" value={roundId ?? ""} />

        <div className="space-y-1.5">
          <Label htmlFor="player-name">Full name</Label>
          <Input id="player-name" name="fullName" defaultValue={player?.full_name} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="player-role">Role</Label>
            <Input id="player-role" name="role" defaultValue={player?.role} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="player-pool">Pool</Label>
            <Input id="player-pool" name="pool" defaultValue={player?.pool} required />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="player-price">Base price</Label>
            <Input
              id="player-price"
              name="basePrice"
              type="number"
              min={0}
              step="0.01"
              defaultValue={player?.base_price ?? 0}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="player-nationality">Nationality</Label>
            <Input id="player-nationality" name="nationality" defaultValue={player?.nationality} required />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="player-overseas"
            name="isOverseas"
            type="checkbox"
            defaultChecked={player?.is_overseas}
            className="size-4"
          />
          <Label htmlFor="player-overseas">Overseas player</Label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="player-ipl-team">IPL team (informational)</Label>
          <Input id="player-ipl-team" name="iplTeam" defaultValue={player?.ipl_team ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="player-stats">Stats (JSON)</Label>
          <Textarea
            id="player-stats"
            name="stats"
            rows={4}
            defaultValue={JSON.stringify(player?.stats ?? {}, null, 2)}
            className="font-mono text-xs"
          />
        </div>

        {state.status === "error" && state.formError && (
          <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
            {state.formError}
          </p>
        )}
        {state.status === "success" && (
          <p className="rounded-lg border border-sold/30 bg-sold/10 px-3 py-2 text-sm text-sold">Saved.</p>
        )}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Saving…" : "Save player"}
        </Button>
      </form>
      <SheetFooter />
    </>
  );
}
