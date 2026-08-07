import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Countdown, EmptyState, StatusPill, Money } from "@/components/bidwave";
import { LiveRealtime } from "@/app/(public)/live/live-realtime";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Live Auction" };
export const dynamic = "force-dynamic";

/**
 * PUB-05/06, LIVE-01..08. Branches on auction_state.ended_at: while live,
 * an active-player hero + pool tabs + chronological feed + rosters;
 * once ended, a calmer final-squad summary (LIVE-08). The analytics badge
 * reads public_analytics_status (Phase 7) — a curated view that collapses
 * pending/rejected to "locked", so this page can never show more than
 * Locked/Purchased regardless of what it queries (AT-AN-03).
 */
export default async function LivePage() {
  const supabase = await createClient();
  const serverNowAtMount = new Date().toISOString();

  const { data: edition } = await selectCurrentEdition(supabase);

  const { data: round } = await supabase
    .from("rounds_with_status")
    .select("opens_at")
    .eq("kind", "auction")
    .maybeSingle();

  if (!edition) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <h1 className="font-display text-4xl">Live Auction</h1>
        <EmptyState
          title="Coverage hasn't started yet"
          description="Live auction coverage begins during Round 5 (Day 2, 18–19 August 2026)."
        />
      </div>
    );
  }

  const [{ data: state }, { data: players }, { data: sales }, { data: purses }, { data: analyticsStatuses }] =
    await Promise.all([
      supabase.from("auction_state").select("*").eq("event_edition_id", edition.id).maybeSingle(),
      supabase
        .from("players_public")
        .select("*")
        .eq("event_edition_id", edition.id)
        .order("pool")
        .order("full_name"),
      supabase
        .from("public_sales_feed")
        .select("*")
        .order("sold_at", { ascending: false })
        .limit(30),
      supabase.from("public_team_purses").select("*").eq("event_edition_id", edition.id).order("name"),
      supabase.from("public_analytics_status").select("*").eq("event_edition_id", edition.id),
    ]);

  const analyticsStatusByTeam = new Map((analyticsStatuses ?? []).map((a) => [a.team_id, a.status]));

  const ended = !!state?.ended_at;
  // auction_state.active_player_id is a pointer, not a guarantee (see the
  // matching comment in admin/auction/console/page.tsx) — only treat it as
  // "on the block" if the player's live status still says active.
  const activePlayerCandidate = !ended && state?.active_player_id
    ? (players ?? []).find((p) => p.id === state.active_player_id)
    : null;
  const activePlayer = activePlayerCandidate?.status === "active" ? activePlayerCandidate : null;

  const playersByPool = new Map<string, typeof players>();
  for (const p of players ?? []) {
    if (!playersByPool.has(p.pool)) playersByPool.set(p.pool, []);
    playersByPool.get(p.pool)!.push(p);
  }

  if (!state) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <h1 className="font-display text-4xl">Live Auction</h1>
        {round?.opens_at ? (
          <div className="space-y-2">
            <p className="text-ink-2">The Grand Auction begins in</p>
            <Countdown target={round.opens_at} serverNowAtMount={serverNowAtMount} className="text-3xl text-gold" />
          </div>
        ) : (
          <EmptyState
            title="Coverage hasn't started yet"
            description="Live auction coverage begins during Round 5 (Day 2, 18–19 August 2026)."
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-12">
      <LiveRealtime eventEditionId={edition.id} />

      <div className="text-center">
        <h1 className="font-display text-4xl">{ended ? "Final Squads" : "Live Auction"}</h1>
        {ended && <p className="mt-1 text-sm text-ink-2">The Grand Auction has concluded.</p>}
      </div>

      {!ended && activePlayer && (
        <section className="rounded-2xl border border-gold/30 bg-gold/5 p-8 text-center">
          <StatusPill status="active" label="On the block" />
          <p className="mt-3 font-display text-3xl">{activePlayer.full_name}</p>
          <p className="text-sm text-ink-2">
            {activePlayer.role} · {activePlayer.pool} · Base <Money value={activePlayer.base_price} />
          </p>
        </section>
      )}

      <section className="space-y-6">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          {ended ? "Final Squads" : "Player Pools"}
        </h2>
        {(purses ?? []).map((team) => {
          const teamPlayers = (players ?? []).filter((p) => p.current_team_id === team.team_id && p.status === "sold");
          return (
            <div key={team.team_id} className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-heading text-sm font-semibold">{team.name}</p>
                  {analyticsStatusByTeam.get(team.team_id) === "purchased" ? (
                    <StatusPill status="purchased" label="Analytics purchased" className="mt-1" />
                  ) : (
                    <StatusPill status="locked" label="Analytics locked" className="mt-1" />
                  )}
                </div>
                <Money value={team.purse_balance ?? 0} className="text-lg text-gold" />
              </div>
              {teamPlayers.length === 0 ? (
                <p className="text-xs text-ink-3">No players yet.</p>
              ) : (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {teamPlayers.map((p) => (
                    <li key={p.id} className="flex items-center justify-between text-sm">
                      <span>
                        {p.full_name} <span className="text-xs text-ink-3">({p.role})</span>
                      </span>
                      <Money value={p.sale_price ?? 0} className="text-xs" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {!ended && (
        <>
          <section className="space-y-4">
            <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
              Player pools
            </h2>
            {Array.from(playersByPool.entries()).map(([pool, poolPlayers]) => (
              <div key={pool}>
                <p className="mb-2 font-heading text-xs font-semibold uppercase text-ink-2">Pool {pool}</p>
                <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {(poolPlayers ?? []).map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                    >
                      <span>{p.full_name}</span>
                      <StatusPill status={p.status} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
              Sales feed
            </h2>
            {!sales || sales.length === 0 ? (
              <EmptyState title="No sales yet" />
            ) : (
              <ul className="space-y-1.5">
                {sales.map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-sm">
                    <span className={s.reversed_at ? "text-unsold line-through" : ""}>
                      {s.player_name} → {s.team_name}
                    </span>
                    <Money value={s.amount} className="text-xs" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
