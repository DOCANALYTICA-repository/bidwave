"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ReconnectBanner, StatusPill } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  QuickCombobox,
  type QuickComboboxItem,
} from "@/app/admin/auction/quick-combobox";
import {
  executeTrade,
  type TradeActionState,
} from "@/app/admin/auction/trades/actions";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";
import {
  formatCrore,
  formatRupees,
  parseCroreInput,
} from "@/lib/auction/format";
import type { BiddingTeamOption } from "@/lib/auction/bidding-field";

export type TradeSquadPlayer = {
  id: string;
  fullName: string;
  role: string;
  pool: string;
  isOverseas: boolean;
  salePrice: number;
};

type RuleSet = {
  maxSquadSize: number;
  minSquadSize: number;
  maxOverseas: number;
};

/** One in-progress trade, before it is submitted. */
type Draft = {
  teamAId: string;
  teamBId: string;
  sendA: string[];
  sendB: string[];
  cashA: string;
  cashB: string;
};

const EMPTY_DRAFT: Draft = {
  teamAId: "",
  teamBId: "",
  sendA: [],
  sendB: [],
  cashA: "",
  cashB: "",
};

// "use server" files can only export async functions — this initial-state
// literal has to live here on the client side.
const tradeActionInitialState: TradeActionState = { status: "idle" };

function humanizeViolation(v: unknown): string {
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const rule = String(obj.rule ?? "constraint");
    const detail = Object.entries(obj)
      .filter(([k]) => k !== "rule")
      .map(([k, val]) => `${k}: ${val}`)
      .join(", ");
    return detail ? `${rule} — ${detail}` : rule;
  }
  return String(v);
}

/** What one side of the deal looks like after the swap. Display only — execute_trade re-derives it. */
type SidePreview = {
  squadSize: number;
  overseas: number;
  purse: number;
  squadOk: boolean;
  overseasOk: boolean;
  purseOk: boolean;
};

export function TradeForm({
  eventEditionId,
  teams,
  squadsByTeam,
  auctionEnded,
  ruleSet,
}: {
  eventEditionId: string;
  teams: BiddingTeamOption[];
  squadsByTeam: Record<string, TradeSquadPlayer[]>;
  auctionEnded: boolean;
  ruleSet: RuleSet | null;
}) {
  const router = useRouter();
  const { status } = useLiveBroadcast(eventEditionId, "auction", () =>
    router.refresh(),
  );
  const [state, formAction, isPending] = useActionState(
    executeTrade,
    tradeActionInitialState,
  );

  /**
   * The whole draft trade in one state object, tagged with the action result it
   * belongs to.
   *
   * A successful execute has to empty the form — both squads it was built from
   * have just changed underneath it, so every tick and both franchise pickers
   * are stale. Deriving that from the action's own identity, rather than
   * resetting six pieces of state inside an effect, means the clear cannot land
   * out of order with the router refresh that follows it.
   */
  const [draftState, setDraftState] = useState<{
    forResult: TradeActionState | null;
    draft: Draft;
  }>({ forResult: null, draft: EMPTY_DRAFT });
  const lastSuccess = state.status === "success" ? state : null;
  const draft =
    draftState.forResult === lastSuccess ? draftState.draft : EMPTY_DRAFT;
  const { teamAId, teamBId, sendA, sendB, cashA, cashB } = draft;

  function update(patch: Partial<Draft>) {
    setDraftState({ forResult: lastSuccess, draft: { ...draft, ...patch } });
  }

  function toggle(key: "sendA" | "sendB", playerId: string) {
    const current = draft[key];
    update({
      [key]: current.includes(playerId)
        ? current.filter((x) => x !== playerId)
        : [...current, playerId],
    });
  }

  useEffect(() => {
    if (state.status === "success") {
      toast.success("Trade executed.");
      router.refresh();
    }
    if (state.status === "error" && state.formError)
      toast.error(state.formError);
  }, [state, router]);

  const teamA = teams.find((t) => t.teamId === teamAId) ?? null;
  const teamB = teams.find((t) => t.teamId === teamBId) ?? null;
  // Memoized because `preview` depends on them: the `?? []` fallback would
  // otherwise be a fresh array identity on every render.
  const squadA = useMemo(
    () => (teamAId ? (squadsByTeam[teamAId] ?? []) : []),
    [teamAId, squadsByTeam],
  );
  const squadB = useMemo(
    () => (teamBId ? (squadsByTeam[teamBId] ?? []) : []),
    [teamBId, squadsByTeam],
  );

  const cashAOut = parseCroreInput(cashA) ?? 0;
  const cashBOut = parseCroreInput(cashB) ?? 0;
  const cashAInvalid = cashA.trim() !== "" && parseCroreInput(cashA) === null;
  const cashBInvalid = cashB.trim() !== "" && parseCroreInput(cashB) === null;

  function teamItems(exclude: string): QuickComboboxItem[] {
    return teams
      .filter((t) => t.teamId !== exclude)
      .map((t) => ({
        id: t.teamId,
        label: t.label,
        keywords: t.name,
        detail: `${(squadsByTeam[t.teamId] ?? []).length} in squad`,
        meta: formatCrore(t.purseBalance),
        metaTitle: `Purse remaining ${formatRupees(t.purseBalance)}`,
      }));
  }

  /**
   * Advisory pre-flight. Mirrors execute_trade's post-move checks so the admin
   * sees a breach before submitting rather than as a rejection — but it is
   * never the gate: the server re-derives all of this against locked rows, and
   * a stale page here would otherwise be able to wave through an illegal trade.
   */
  const preview = useMemo((): { a: SidePreview; b: SidePreview } | null => {
    if (!teamA || !teamB || !ruleSet) return null;
    const build = (
      team: BiddingTeamOption,
      squad: TradeSquadPlayer[],
      outgoing: string[],
      incoming: TradeSquadPlayer[],
      cashOut: number,
      cashIn: number,
    ): SidePreview => {
      const kept = squad.filter((p) => !outgoing.includes(p.id));
      const squadSize = kept.length + incoming.length;
      const overseas =
        kept.filter((p) => p.isOverseas).length +
        incoming.filter((p) => p.isOverseas).length;
      const purse = team.purseBalance - cashOut + cashIn;
      return {
        squadSize,
        overseas,
        purse,
        squadOk: squadSize <= ruleSet.maxSquadSize,
        overseasOk: overseas <= ruleSet.maxOverseas,
        purseOk: purse >= 0,
      };
    };
    const movingA = squadA.filter((p) => sendA.includes(p.id));
    const movingB = squadB.filter((p) => sendB.includes(p.id));
    return {
      a: build(teamA, squadA, sendA, movingB, cashAOut, cashBOut),
      b: build(teamB, squadB, sendB, movingA, cashBOut, cashAOut),
    };
  }, [teamA, teamB, ruleSet, squadA, squadB, sendA, sendB, cashAOut, cashBOut]);

  const movesSomething =
    sendA.length > 0 || sendB.length > 0 || cashAOut > 0 || cashBOut > 0;
  const previewBlocks =
    preview != null &&
    [preview.a, preview.b].some(
      (s) => !s.squadOk || !s.overseasOk || !s.purseOk,
    );

  return (
    <div className="space-y-4">
      <ReconnectBanner status={status} />

      {auctionEnded && (
        <div className="rounded-lg border border-gold/40 bg-gold/5 px-4 py-3 text-xs text-ink-2">
          The auction has ended. A trade will still apply — squads, purses and
          final results all derive from the same rows — so only trade now if
          that is genuinely intended.
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="eventEditionId" value={eventEditionId} />
        <input type="hidden" name="teamAId" value={teamAId} />
        <input type="hidden" name="teamBId" value={teamBId} />

        <div className="grid gap-4 lg:grid-cols-2">
          <TradeSide
            side="A"
            team={teamA}
            teamItems={teamItems(teamBId)}
            onPickTeam={(id) => {
              // The squad on screen belongs to the franchise that was there a
              // moment ago; carrying ticks across would post another team's
              // player ids.
              update({ teamAId: id, sendA: [] });
            }}
            squad={squadA}
            selected={sendA}
            onToggle={(id) => toggle("sendA", id)}
            playerFieldName="playersAToB"
            cash={cashA}
            cashInvalid={cashAInvalid}
            onCash={(value) => update({ cashA: value })}
            cashFieldName="cashAToB"
            receivingLabel={teamB?.label ?? "the other franchise"}
            preview={preview?.a ?? null}
            ruleSet={ruleSet}
          />
          <TradeSide
            side="B"
            team={teamB}
            teamItems={teamItems(teamAId)}
            onPickTeam={(id) => update({ teamBId: id, sendB: [] })}
            squad={squadB}
            selected={sendB}
            onToggle={(id) => toggle("sendB", id)}
            playerFieldName="playersBToA"
            cash={cashB}
            cashInvalid={cashBInvalid}
            onCash={(value) => update({ cashB: value })}
            cashFieldName="cashBToA"
            receivingLabel={teamA?.label ?? "the other franchise"}
            preview={preview?.b ?? null}
            ruleSet={ruleSet}
          />
        </div>

        {teamA && teamB && (
          <div className="space-y-1.5 rounded-xl border border-border bg-card p-4">
            <Label htmlFor="trade-memo">Note (optional)</Label>
            <Input
              id="trade-memo"
              name="memo"
              maxLength={280}
              placeholder="Why this trade happened — shown in the trade log."
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-3">
            {!teamA || !teamB
              ? "Pick both franchises to build a trade."
              : !movesSomething
                ? "Tick at least one player, or enter cash on either side."
                : previewBlocks
                  ? "This trade breaches the active rule set — the server will reject it."
                  : "Applied as one transaction. Reversible from the log below."}
          </p>
          <Button
            type="submit"
            disabled={
              isPending ||
              !teamA ||
              !teamB ||
              !movesSomething ||
              cashAInvalid ||
              cashBInvalid
            }
          >
            {isPending ? "Executing…" : "Execute trade"}
          </Button>
        </div>

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
      </form>
    </div>
  );
}

function TradeSide({
  side,
  team,
  teamItems,
  onPickTeam,
  squad,
  selected,
  onToggle,
  playerFieldName,
  cash,
  cashInvalid,
  onCash,
  cashFieldName,
  receivingLabel,
  preview,
  ruleSet,
}: {
  side: "A" | "B";
  team: BiddingTeamOption | null;
  teamItems: QuickComboboxItem[];
  onPickTeam: (teamId: string) => void;
  squad: TradeSquadPlayer[];
  selected: string[];
  onToggle: (playerId: string) => void;
  playerFieldName: string;
  cash: string;
  cashInvalid: boolean;
  onCash: (value: string) => void;
  cashFieldName: string;
  receivingLabel: string;
  preview: SidePreview | null;
  ruleSet: RuleSet | null;
}) {
  const pickerId = `trade-team-${side.toLowerCase()}`;
  const cashId = `trade-cash-${side.toLowerCase()}`;

  return (
    // data-trade-side is the only stable handle on this panel once a franchise
    // is picked: the combobox (and its id) is replaced by the chip, so a spec
    // reading the purse tooltip has nothing else to anchor to.
    <div
      data-trade-side={side.toLowerCase()}
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor={pickerId}>Franchise {side}</Label>
        {team ? (
          <div className="flex h-8 items-center justify-between gap-2 rounded-lg border border-gold/40 bg-gold/10 px-2.5 text-sm">
            <span className="min-w-0 truncate font-medium">{team.label}</span>
            <span
              title={`Purse remaining ${formatRupees(team.purseBalance)}`}
              className="shrink-0 font-mono text-xs tabular-nums text-ink-2"
            >
              {formatCrore(team.purseBalance)}
            </span>
            <button
              type="button"
              aria-label={`Change franchise ${side}`}
              className="shrink-0 text-ink-3 hover:text-ink-1"
              onClick={() => onPickTeam("")}
            >
              ✕
            </button>
          </div>
        ) : (
          <QuickCombobox
            id={pickerId}
            items={teamItems}
            placeholder="Search franchise…"
            emptyLabel="No franchise matches"
            onSelect={(item) => onPickTeam(item.id)}
          />
        )}
      </div>

      {team && (
        <>
          <fieldset className="space-y-1">
            <legend className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Players to {receivingLabel}
              {selected.length > 0 && ` · ${selected.length} selected`}
            </legend>
            {squad.length === 0 ? (
              <p className="py-2 text-sm text-ink-3">
                This franchise has no squad yet.
              </p>
            ) : (
              <ul className="max-h-64 space-y-0.5 overflow-y-auto pt-1">
                {squad.map((p) => {
                  const inputId = `${playerFieldName}-${p.id}`;
                  return (
                    <li key={p.id}>
                      <label
                        htmlFor={inputId}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2"
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          name={playerFieldName}
                          value={p.id}
                          checked={selected.includes(p.id)}
                          onChange={() => onToggle(p.id)}
                          className="size-4 shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {p.fullName}
                          {p.isOverseas && (
                            <span className="ml-1 text-xs text-ink-3">
                              · overseas
                            </span>
                          )}
                        </span>
                        <span
                          title={`Bought for ${formatRupees(p.salePrice)}`}
                          className="shrink-0 font-mono text-xs tabular-nums text-ink-3"
                        >
                          {formatCrore(p.salePrice)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={cashId}>Cash to {receivingLabel}</Label>
            <div className="relative w-32">
              <Input
                id={cashId}
                name={cashFieldName}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className="pr-9 font-mono tabular-nums"
                placeholder="0"
                value={cash}
                onChange={(e) => onCash(e.target.value)}
                aria-invalid={cashInvalid}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-3"
              >
                Cr
              </span>
            </div>
          </div>

          {preview && ruleSet && (
            <div className="space-y-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                After trade
              </p>
              <div className="flex flex-wrap gap-2 text-sm">
                <StatusPill
                  status={preview.squadOk ? "qualified" : "eliminated"}
                  label={`Squad ${preview.squadSize}/${ruleSet.minSquadSize}-${ruleSet.maxSquadSize}`}
                />
                <StatusPill
                  status={preview.overseasOk ? "qualified" : "eliminated"}
                  label={`Overseas ${preview.overseas}/${ruleSet.maxOverseas}`}
                />
                <StatusPill
                  status={preview.purseOk ? "qualified" : "eliminated"}
                  label={`Purse ${formatCrore(preview.purse)}`}
                />
              </div>
              {preview.squadSize < ruleSet.minSquadSize && (
                <p className="text-xs text-ink-3">
                  Below the {ruleSet.minSquadSize}-player minimum. Allowed
                  mid-auction — the floor is a final-squad rule, not a per-move
                  one — but they must get back above it.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
