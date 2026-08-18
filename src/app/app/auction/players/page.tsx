import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BackLink, EmptyState, Money, StatusPill } from "@/components/bidwave";
import { TeamAuctionRealtime } from "@/app/app/auction/team-auction-realtime";
import { selectCurrentEdition } from "@/lib/event-edition";
import { getSettingsForEdition } from "@/lib/supabase/settings";
import type { StatusKey } from "@/components/bidwave/status-pill";
import { DEFAULT_PARTICIPANT_VISIBILITY } from "@/lib/validation/auction";

export const metadata: Metadata = { title: "Player list" };
export const dynamic = "force-dynamic";

type CatalogPlayer = {
  id: string;
  full_name: string;
  nationality: string;
  pool: string;
  // players.status is a closed vocabulary in the DB and StatusPill covers
  // every value it can hold, so the cast in the query below is safe.
  status: StatusKey;
  role?: string | null;
  base_price?: number | null;
  ipl_team?: string | null;
};

/**
 * The participant-facing player catalogue, organised by pool in auction
 * order (pools are named "POT 01 · …" at import time precisely so a lexical
 * sort equals the real bidding sequence).
 *
 * Name, nationality, pool and live status are always shown. Role, base price
 * and previous IPL team are gated by the admin's participant_field_visibility
 * setting, and — critically — a hidden field is *left out of the select
 * list*, not merely omitted from the markup. Restricted values never leave
 * Postgres, so there is nothing to find in the page source or the RSC
 * payload (architecture principle #1).
 *
 * `stats` cannot appear here at all: players_public excludes it outright, and
 * statistics stay behind the paid analytics unlock (AN-01..08).
 */
export default async function TeamPlayerCatalogPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return <div className="p-10 text-ink-2">No active event edition.</div>;

  const settings = await getSettingsForEdition(edition.id, ["participant_field_visibility"]);
  const visibility = settings.participant_field_visibility ?? DEFAULT_PARTICIPANT_VISIBILITY;

  const columns = ["id", "full_name", "nationality", "pool", "status"];
  if (visibility.role) columns.push("role");
  if (visibility.base_price) columns.push("base_price");
  if (visibility.ipl_team) columns.push("ipl_team");

  const { data } = await supabase
    .from("players_public")
    .select(columns.join(", "))
    .eq("event_edition_id", edition.id)
    .order("pool")
    .order("full_name");

  const players = (data ?? []) as unknown as CatalogPlayer[];

  const byPool = new Map<string, CatalogPlayer[]>();
  for (const p of players) {
    if (!byPool.has(p.pool)) byPool.set(p.pool, []);
    byPool.get(p.pool)!.push(p);
  }

  const hiddenLabels = [
    !visibility.role && "role",
    !visibility.base_price && "base price",
    !visibility.ipl_team && "previous IPL team",
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-12">
      <TeamAuctionRealtime eventEditionId={edition.id} />

      <div className="space-y-2">
        <BackLink href="/app/auction" label="Back to your squad" />
        <h1 className="font-display text-3xl">Player list</h1>
        <p className="text-sm text-ink-2">
          Every player in the auction, grouped by pool in the order they come up for bidding.{" "}
          {players.length} players across {byPool.size} pools.
        </p>
        {hiddenLabels.length > 0 && (
          <p className="text-xs text-ink-3">
            Not yet revealed by the organisers: {hiddenLabels.join(", ")}.
          </p>
        )}
      </div>

      {byPool.size === 0 ? (
        <EmptyState
          title="No players yet"
          description="The player list appears here once the auction pool is published."
        />
      ) : (
        <div className="space-y-8">
          {Array.from(byPool.entries()).map(([pool, poolPlayers]) => (
            <section key={pool} className="space-y-3">
              <div className="flex items-baseline justify-between border-b border-border pb-2">
                <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
                  {pool}
                </h2>
                <span className="font-mono text-xs text-ink-3">{poolPlayers.length} players</span>
              </div>
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {poolPlayers.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{p.full_name}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {[
                          visibility.role ? p.role : null,
                          p.nationality,
                          visibility.ipl_team && p.ipl_team ? p.ipl_team : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {visibility.base_price && p.base_price != null && (
                        <Money value={p.base_price} className="text-xs text-ink-2" />
                      )}
                    </span>
                    <StatusPill status={p.status} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
