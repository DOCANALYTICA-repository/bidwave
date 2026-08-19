"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ReconnectBanner, StatusPill } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  recordSale,
  activatePlayerForBidding,
  markPlayerUnsold,
  endAuction,
  type ActivateForBiddingResult,
  type SaleActionState,
} from "@/app/admin/auction/console/actions";
import { ConsoleLockBadge } from "@/app/admin/auction/console/console-lock-badge";
import {
  QuickCombobox,
  type QuickComboboxItem,
} from "@/app/admin/auction/quick-combobox";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";
import {
  formatCrore,
  formatRupees,
  parseCroreInput,
  rupeesToCroreInput,
} from "@/lib/auction/format";
import type { BiddingField } from "@/lib/auction/bidding-field";
import type { Database } from "@/lib/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];
type RuleSet = {
  min_squad_size: number;
  max_squad_size: number;
  max_overseas: number;
};
type TeamRoster = {
  squadSize: number;
  overseasCount: number;
  roleCounts: Record<string, number>;
  poolCounts: Record<string, number>;
};

/** The searchable pool: everything the console may put up for bidding next. */
export type OpenPlayer = Pick<
  Player,
  | "id"
  | "full_name"
  | "role"
  | "pool"
  | "base_price"
  | "status"
  | "is_overseas"
  | "updated_at"
>;

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
  openPlayers,
  biddingField,
  auctionEnded,
  ruleSet,
  rosterByTeam,
}: {
  eventEditionId: string;
  activePlayer: Player | null;
  openPlayers: OpenPlayer[];
  biddingField: BiddingField;
  auctionEnded: boolean;
  ruleSet: RuleSet | null;
  rosterByTeam: Record<string, TeamRoster>;
}) {
  const teams = biddingField.teams;
  const router = useRouter();
  const { status } = useLiveBroadcast(eventEditionId, "auction", () =>
    router.refresh(),
  );
  const [isBusy, setIsBusy] = useState(false);

  /**
   * The player the console is *treating* as up for bidding, ahead of the server
   * confirming it. Picking a player from the search costs a round-trip (up to
   * three RPCs — see activatePlayerForBidding) plus a router refresh; making the
   * admin watch that before they can type the team and price would put the whole
   * latency back on the critical path of every lot. Instead the sale form appears
   * the instant a name is picked, and the activation flies in the background.
   */
  const [staged, setStaged] = useState<Player | OpenPlayer | null>(null);
  /**
   * The in-flight activation, tagged with whose it is. The sale action and the
   * Mark-unsold button both await it for the `updated_at` it produced. Tagged
   * rather than cleared so a slow activation for the previous lot can never hand
   * its token to the next one.
   */
  const activationRef = useRef<{
    playerId: string;
    promise: Promise<ActivateForBiddingResult>;
  } | null>(null);

  /**
   * The sale action, wrapped so that waiting for the in-flight activation
   * happens *inside* it.
   *
   * record_sale checks `expected_player_updated_at`, and every activation step
   * bumps `updated_at` — so a sale submitted before the activation lands has to
   * wait for the token it produced. Awaiting that in an onSubmit handler and
   * then calling the dispatch put the dispatch outside React's transition,
   * which silently broke `isPending` (no "Recording…", no disabled button, so a
   * double-tap could submit twice). Doing it here instead means the form stays a
   * plain `action={formAction}` — native Enter-to-submit, React-owned
   * transition, accurate isPending — and the await sits where async work
   * belongs.
   */
  const [state, formAction, isPending] = useActionState(
    async (
      prev: SaleActionState,
      formData: FormData,
    ): Promise<SaleActionState> => {
      const activation = activationRef.current;
      if (activation && activation.playerId === formData.get("playerId")) {
        const result = await activation.promise;
        // The activation failed and already told the admin why; a sale against
        // a player who never went up would only produce a second, vaguer error.
        if (result.error) return prev;
        if (result.player)
          formData.set("expectedUpdatedAt", result.player.updated_at);
      }
      return recordSale(prev, formData);
    },
    saleActionInitialState,
  );

  const searchRef = useRef<HTMLInputElement>(null);
  const teamSearchRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  /**
   * Where focus should go once the DOM catches up.
   *
   * The console hands focus along the loop (player -> franchise -> amount ->
   * player), but two of those hops target a field that does not exist yet at the
   * moment the hop is decided: picking a player is what *creates* the sale form,
   * and clearing the franchise is what recreates its combobox. Focusing straight
   * from the handler therefore hit a null ref and silently did nothing — the
   * admin picked a name and then had to reach for the mouse anyway, which is the
   * entire cost this workflow exists to remove. Recorded as intent here and
   * consumed by the effect below, once the field is mounted.
   */
  const focusIntentRef = useRef<"team" | "amount" | null>(null);

  /**
   * Everything below is *derived*, not reset in an effect. The console clears
   * itself between lots purely as a function of "which player is up", so a
   * successful sale, a displaced player and a router refresh all converge on the
   * same empty form with no ordering hazard between them.
   */
  const soldPlayerId = state.status === "success" ? state.playerId : undefined;
  // Both the optimistic copy and the server's own row are ignored once that
  // player's sale has landed; the refresh that follows makes it official.
  const confirmed =
    activePlayer && activePlayer.id !== soldPlayerId ? activePlayer : null;
  const pending = staged && staged.id !== soldPlayerId ? staged : null;
  // Props win when they describe the same player — they carry the
  // authoritative `updated_at`.
  const player =
    confirmed?.id === pending?.id
      ? (confirmed ?? pending)
      : (pending ?? confirmed);
  const playerId = player?.id ?? null;

  // Keyed by player, so the franchise and amount empty themselves the moment
  // the lot changes — the two fields most dangerous to carry over.
  const [teamPick, setTeamPick] = useState<{
    playerId: string;
    teamId: string;
  } | null>(null);
  const teamId =
    teamPick && teamPick.playerId === playerId ? teamPick.teamId : "";
  const selectedTeam = teams.find((t) => t.teamId === teamId) ?? null;

  const [amountEdit, setAmountEdit] = useState<{
    playerId: string;
    value: string;
  } | null>(null);
  // Bids open at base price far more often than not, so that is the value until
  // the admin types over it — one less thing to enter when it clears at base.
  const amountCrore =
    amountEdit && amountEdit.playerId === playerId
      ? amountEdit.value
      : player
        ? rupeesToCroreInput(player.base_price)
        : "";

  /**
   * `state` from useActionState is the identity to key off, not the render.
   * `router` changes identity across a refresh, and the success branch below
   * triggers one — without this guard the block re-entered and the admin got
   * two "Sale recorded." toasts plus a second redundant refresh per lot.
   */
  const handledResultRef = useRef<SaleActionState | null>(null);
  useEffect(() => {
    if (handledResultRef.current === state) return;
    handledResultRef.current = state;
    if (state.status === "success") {
      toast.success("Sale recorded.");
      // Straight back to the top of the loop: the next lot is usually already
      // being called by the time this lands.
      searchRef.current?.focus();
      router.refresh();
    }
    if (state.status === "error" && state.formError)
      toast.error(state.formError);
  }, [state, router]);

  // Deliberately a DOM effect, not state: it only moves the caret.
  useEffect(() => {
    const intent = focusIntentRef.current;
    if (!intent) return;
    const target =
      intent === "team" ? teamSearchRef.current : amountRef.current;
    if (!target) return;
    focusIntentRef.current = null;
    target.focus();
    target.select();
  }, [playerId, teamId]);

  const playerItems: QuickComboboxItem[] = useMemo(
    () =>
      openPlayers
        .filter((p) => p.id !== playerId)
        .map((p) => ({
          id: p.id,
          label: p.full_name,
          keywords: `${p.role} ${p.pool} ${p.status}`,
          detail: `${p.pool} · ${p.role}${p.is_overseas ? " · overseas" : ""}${
            p.status === "unsold"
              ? " · UNSOLD, back round"
              : p.status === "recalled"
                ? " · recalled"
                : ""
          }`,
          meta: formatCrore(p.base_price),
          metaTitle: `Base price ${formatRupees(p.base_price)}`,
        })),
    [openPlayers, playerId],
  );

  const teamItems: QuickComboboxItem[] = useMemo(
    () =>
      teams.map((t) => ({
        id: t.teamId,
        label: t.label,
        keywords: t.name,
        detail: t.franchise
          ? undefined
          : "registered name — no franchise seated",
        meta: formatCrore(t.purseBalance),
        metaTitle: `Purse remaining ${formatRupees(t.purseBalance)}`,
      })),
    [teams],
  );

  function activate(id: string) {
    const picked = openPlayers.find((p) => p.id === id);
    if (!picked) return;
    setStaged(picked);
    // Promise.resolve wraps it so a server action that throws outright (a
    // dropped connection mid-auction is not hypothetical) lands in the catch
    // below rather than as an unhandled rejection, and so submit's `await`
    // always has something to await.
    const promise = Promise.resolve(
      activatePlayerForBidding(picked.id, picked.updated_at),
    )
      .catch((cause: unknown): ActivateForBiddingResult => ({
        error:
          cause instanceof Error
            ? cause.message
            : "Could not put that player up for bidding.",
      }))
      .then((result) => {
        if (result.error) {
          toast.error(result.error);
          setStaged((current) => (current?.id === picked.id ? null : current));
        } else {
          if (result.displaced)
            toast.info(`${result.displaced.full_name} closed out as unsold.`);
          // Swap in the real row for its fresh `updated_at`, unless the admin
          // has already moved on to another lot.
          if (result.player)
            setStaged((current) =>
              current?.id === picked.id ? result.player! : current,
            );
        }
        router.refresh();
        return result;
      });
    activationRef.current = { playerId: picked.id, promise };
    // Straight to the franchise field — the price is usually still being called.
    // The field may not be mounted yet, so this is an intent, not a call.
    focusIntentRef.current = "team";
    teamSearchRef.current?.focus();
  }

  /** The freshest `updated_at` for the lot on screen, once activation settles. */
  async function currentToken(fallback: string): Promise<string | null> {
    const activation = activationRef.current;
    if (!activation || activation.playerId !== playerId) return fallback;
    const result = await activation.promise;
    if (result.error) return null; // already surfaced by activate()
    return result.player?.updated_at ?? fallback;
  }

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

      {/* Step 1 of the loop, and always on screen: the lot under the hammer can
          change before the previous one is entered, and the admin should never
          have to leave the console to follow it. */}
      <div className="space-y-1.5 rounded-xl border border-border bg-card p-4">
        <Label htmlFor="player-search">
          Player up for bidding{" "}
          <span className="font-normal text-ink-3">
            — {openPlayers.length} available or unsold. Type a name, ↑↓, Enter.
          </span>
        </Label>
        <QuickCombobox
          id="player-search"
          items={playerItems}
          inputRef={searchRef}
          placeholder="Search unsold and available players…"
          emptyLabel="No available or unsold player matches"
          onSelect={(item) => activate(item.id)}
        />
      </div>

      {!player ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-ink-2">
          No player is currently up for bidding. Search above to put one up.
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-gold/30 bg-gold/5 p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-display text-2xl">{player.full_name}</p>
              <p className="text-sm text-ink-2">
                {player.role} · {player.pool} · Base{" "}
                {formatCrore(player.base_price)}
                {player.is_overseas ? " · overseas" : ""}
              </p>
            </div>
            <ConsoleLockBadge
              recordType="player"
              recordId={player.id}
              deviceLabel="Console"
            />
          </div>

          {/* §24.4: no confirmation friction on routine sale entry — one button, native Enter-to-submit. */}
          <form className="flex flex-wrap items-end gap-3" action={formAction}>
            <input type="hidden" name="playerId" value={player.id} />
            <input
              type="hidden"
              name="expectedUpdatedAt"
              value={player.updated_at}
            />
            <input type="hidden" name="teamId" value={teamId} />

            <div className="space-y-1.5">
              <Label htmlFor="sale-team">Team</Label>
              {selectedTeam ? (
                <div className="flex h-8 w-56 items-center justify-between gap-2 rounded-lg border border-gold/40 bg-gold/10 px-2.5 text-sm">
                  <span className="min-w-0 truncate font-medium">
                    {selectedTeam.label}
                  </span>
                  <span
                    title={`Purse remaining ${formatRupees(selectedTeam.purseBalance)}`}
                    className="shrink-0 font-mono text-xs tabular-nums text-ink-2"
                  >
                    {formatCrore(selectedTeam.purseBalance)}
                  </span>
                  <button
                    type="button"
                    aria-label="Change franchise"
                    className="shrink-0 text-ink-3 hover:text-ink-1"
                    onClick={() => {
                      setTeamPick(null);
                      // The ref points at the combobox that is about to mount.
                      window.setTimeout(
                        () => teamSearchRef.current?.focus(),
                        0,
                      );
                    }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <QuickCombobox
                  id="sale-team"
                  className="w-56"
                  items={teamItems}
                  inputRef={teamSearchRef}
                  placeholder="Select franchise"
                  emptyLabel="No franchise matches"
                  onSelect={(item) => {
                    setTeamPick({ playerId: player.id, teamId: item.id });
                    // Picking a franchise swaps the combobox out for the chip,
                    // so the amount field is reachable only after that render.
                    focusIntentRef.current = "amount";
                  }}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sale-amount">Amount</Label>
              {/* Crore in, crore out. The unit is part of the field rather than
                  something to type, so "5.5" is the whole keystroke budget for
                  ₹5,50,00,000. */}
              <div className="relative w-32">
                <Input
                  id="sale-amount"
                  name="amountCrore"
                  ref={amountRef}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="pr-9 font-mono tabular-nums"
                  placeholder="5.5"
                  value={amountCrore}
                  onChange={(e) =>
                    setAmountEdit({
                      playerId: player.id,
                      value: e.target.value,
                    })
                  }
                  aria-invalid={
                    amountCrore.trim() !== "" &&
                    parseCroreInput(amountCrore) === null
                  }
                  required
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-3"
                >
                  Cr
                </span>
              </div>
            </div>

            <Button type="submit" disabled={isPending || !teamId}>
              {isPending ? "Recording…" : "Record sale"}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={async () => {
                setIsBusy(true);
                // Same reason submit awaits it: the activation owns the
                // current `updated_at`.
                const token = await currentToken(player.updated_at);
                if (token === null) {
                  setIsBusy(false);
                  return;
                }
                const result = await markPlayerUnsold(player.id, token);
                setIsBusy(false);
                if (result.error) {
                  toast.error(result.error);
                } else {
                  toast.success("Player marked unsold.");
                  setStaged(null);
                  searchRef.current?.focus();
                }
                router.refresh();
              }}
            >
              Mark unsold
            </Button>
          </form>

          <p className="text-xs text-ink-3">
            Enter records the sale. Amount is in crore — 5.5 is ₹5,50,00,000,
            0.2 is ₹20,00,000.
          </p>

          {teamId && ruleSet && (
            <TeamComplianceSummary
              roster={rosterByTeam[teamId]}
              ruleSet={ruleSet}
            />
          )}

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
            if (
              !confirm(
                "End the auction? This switches /live to the final-summary view.",
              )
            )
              return;
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

function TeamComplianceSummary({
  roster,
  ruleSet,
}: {
  roster: TeamRoster | undefined;
  ruleSet: RuleSet;
}) {
  const squadSize = roster?.squadSize ?? 0;
  const overseasCount = roster?.overseasCount ?? 0;
  const squadOk =
    squadSize >= ruleSet.min_squad_size && squadSize <= ruleSet.max_squad_size;
  const overseasOk = overseasCount <= ruleSet.max_overseas;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        Team constraints
      </p>
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
        Roles:{" "}
        {Object.entries(roster?.roleCounts ?? {})
          .map(([r, c]) => `${r} ${c}`)
          .join(", ") || "—"}{" "}
        · Pools:{" "}
        {Object.entries(roster?.poolCounts ?? {})
          .map(([p, c]) => `${p} ${c}`)
          .join(", ") || "—"}
      </p>
    </div>
  );
}
