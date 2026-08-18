"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Money, ReconnectBanner, StatusPill } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  recordSale,
  setActivePlayer,
  markPlayerUnsold,
  endAuction,
  type SaleActionState,
} from "@/app/admin/auction/console/actions";
import { ConsoleLockBadge } from "@/app/admin/auction/console/console-lock-badge";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";
import type { BiddingField } from "@/lib/auction/bidding-field";
import type { Database } from "@/lib/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];
type RuleSet = { min_squad_size: number; max_squad_size: number; max_overseas: number };
type TeamRoster = { squadSize: number; overseasCount: number; roleCounts: Record<string, number>; poolCounts: Record<string, number> };

// "use server" files can only export async functions — this initial-state
// literal has to live here on the client side.
const saleActionInitialState: SaleActionState = { status: "idle" };

function humanizeViolation(v: unknown): string {
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const rule = String(obj.rule ?? obj.code ?? "constraint");
    const detail = Object.entries(obj)
      .filter(([k]) => k !== "rule" && k !== "code")
      .map(([k, val]) => `${k}: ${val}`)
      .join(", ");
    return detail ? `${rule} — ${detail}` : rule;
  }
  return String(v);
}

export function ConsoleSaleEntry({
  eventEditionId,
  activePlayer,
  biddingField,
  auctionEnded,
  ruleSet,
  rosterByTeam,
}: {
  eventEditionId: string;
  activePlayer: Player | null;
  biddingField: BiddingField;
  auctionEnded: boolean;
  ruleSet: RuleSet | null;
  rosterByTeam: Record<string, TeamRoster>;
}) {
  const teams = biddingField.teams;
  const router = useRouter();
  const { status } = useLiveBroadcast(eventEditionId, "auction", () => router.refresh());
  const [state, formAction, isPending] = useActionState(recordSale, saleActionInitialState);
  const [isBusy, setIsBusy] = useState(false);
  // Select's own `name` prop does not reliably populate its hidden input
  // for FormData in this codebase (confirmed the hard way) — every other
  // Select-in-a-form here (e.g. round-form-sheet.tsx) instead uses a
  // controlled value + a separate plain hidden input, so this follows that
  // same established pattern rather than the framework's built-in form
  // wiring.
  const [teamId, setTeamId] = useState("");

  // Reset the form when a sale actually succeeds (activePlayer changes to
  // null/a new player next render) so a stale success message doesn't
  // linger on the next player.
  useEffect(() => {
    if (state.status === "success") {
      toast.success("Sale recorded.");
      router.refresh();
    }
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state, router]);

  if (auctionEnded) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-ink-2">
        The auction has ended. See the final squad summaries on /live.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ReconnectBanner status={status} />
      <BiddingFieldNotice field={biddingField} />

      {!activePlayer ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-ink-2">
          No player is currently active. Set one active from Players (mark a player &quot;active&quot;) to record a
          sale.
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-gold/30 bg-gold/5 p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-display text-2xl">{activePlayer.full_name}</p>
              <p className="text-sm text-ink-2">
                {activePlayer.role} · {activePlayer.pool} · Base <Money value={activePlayer.base_price} />
              </p>
            </div>
            <ConsoleLockBadge recordType="player" recordId={activePlayer.id} deviceLabel="Console" />
          </div>

          {/* §24.4: no confirmation friction on routine sale entry — one button, native Enter-to-submit. */}
          <form action={formAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="playerId" value={activePlayer.id} />
            <input type="hidden" name="expectedUpdatedAt" value={activePlayer.updated_at} />
            <input type="hidden" name="teamId" value={teamId} />

            <div className="space-y-1.5">
              <Label htmlFor="sale-team">Team</Label>
              <Select value={teamId} onValueChange={(v) => v && setTeamId(v)}>
                <SelectTrigger id="sale-team" className="w-56">
                  {/* SelectValue's default rendering prints the raw `value` —
                      team_id here, not the label — since value and label
                      differ (unlike round-form-sheet.tsx's kind selector,
                      where they're the same string). The render-prop form
                      looks the team back up to show its franchise alias. */}
                  <SelectValue placeholder="Select franchise">
                    {(value: string) =>
                      teams.find((t) => t.teamId === value)?.label ?? "Select franchise"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.teamId} value={t.teamId}>
                      {t.label} — <Money value={t.purseBalance} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sale-amount">Amount</Label>
              <Input
                id="sale-amount"
                name="amount"
                type="number"
                min={0}
                step="0.01"
                defaultValue={activePlayer.base_price}
                required
              />
            </div>

            <Button type="submit" disabled={isPending}>
              {isPending ? "Recording…" : "Record sale"}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={async () => {
                setIsBusy(true);
                await markPlayerUnsold(activePlayer.id, activePlayer.updated_at);
                setIsBusy(false);
                toast.success("Player marked unsold.");
                router.refresh();
              }}
            >
              Mark unsold
            </Button>
          </form>

          {teamId && ruleSet && <TeamComplianceSummary roster={rosterByTeam[teamId]} ruleSet={ruleSet} />}

          {state.status === "error" && (
            <div className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
              <p>{state.formError}</p>
              {state.violations && state.violations.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs">
                  {state.violations.map((v, i) => (
                    <li key={i}>{humanizeViolation(v)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant="destructive"
          size="sm"
          disabled={isBusy}
          onClick={async () => {
            if (!confirm("End the auction? This switches /live to the final-summary view.")) return;
            setIsBusy(true);
            await endAuction(eventEditionId);
            setIsBusy(false);
            toast.success("Auction ended.");
            router.refresh();
          }}
        >
          End auction
        </Button>
      </div>
    </div>
  );
}

/**
 * Says out loud when the selector is not showing what the auctioneer expects.
 * Without this, "no franchises seated yet" and "these are the 12 franchises"
 * look identical on screen — the selector just quietly lists registered team
 * names, and the first sale gets called against the wrong label.
 */
function BiddingFieldNotice({ field }: { field: BiddingField }) {
  const problems: string[] = [];

  if (field.source === "unnarrowed") {
    problems.push(
      `No Rounds 3 + 4 qualification decisions and no franchises seated, so all ${field.teams.length} registered teams are listed. Record qualification in Stages, or seat franchises in Setup.`,
    );
  } else if (field.source === "franchise") {
    problems.push(
      "No Rounds 3 + 4 qualification decisions are recorded, so this list comes from the seated franchises. A sale will still be rejected for any team the stage has not qualified.",
    );
  }

  if (field.missingAlias > 0) {
    problems.push(
      `${field.missingAlias} of ${field.teams.length} ${field.missingAlias === 1 ? "team is" : "teams are"} showing a registered name because no franchise identity is assigned. Assign them in Auction → Setup.`,
    );
  }

  if (problems.length === 0) return null;

  return (
    <div className="space-y-1 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3 text-xs text-ink-2">
      {problems.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </div>
  );
}

function TeamComplianceSummary({ roster, ruleSet }: { roster: TeamRoster | undefined; ruleSet: RuleSet }) {
  const squadSize = roster?.squadSize ?? 0;
  const overseasCount = roster?.overseasCount ?? 0;
  const squadOk = squadSize >= ruleSet.min_squad_size && squadSize <= ruleSet.max_squad_size;
  const overseasOk = overseasCount <= ruleSet.max_overseas;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Team constraints</p>
      <div className="flex flex-wrap gap-2 text-sm">
        <StatusPill
          status={squadOk ? "qualified" : "eliminated"}
          label={`Squad ${squadSize}/${ruleSet.min_squad_size}-${ruleSet.max_squad_size}`}
        />
        <StatusPill
          status={overseasOk ? "qualified" : "eliminated"}
          label={`Overseas ${overseasCount}/${ruleSet.max_overseas}`}
        />
      </div>
      <p className="text-xs text-ink-3">
        Roles: {Object.entries(roster?.roleCounts ?? {}).map(([r, c]) => `${r} ${c}`).join(", ") || "—"} · Pools:{" "}
        {Object.entries(roster?.poolCounts ?? {}).map(([p, c]) => `${p} ${c}`).join(", ") || "—"}
      </p>
    </div>
  );
}

/** Standalone control for setting a player active — used from the players list. */
export function ActivatePlayerButton({ playerId, expectedUpdatedAt }: { playerId: string; expectedUpdatedAt: string }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={isBusy}
      onClick={async () => {
        setIsBusy(true);
        const result = await setActivePlayer(playerId, expectedUpdatedAt);
        setIsBusy(false);
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success("Player set active.");
        }
        router.refresh();
      }}
    >
      {isBusy ? "Activating…" : "Set active"}
    </Button>
  );
}
