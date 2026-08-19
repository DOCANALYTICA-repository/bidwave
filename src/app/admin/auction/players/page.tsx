import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PlayersTable } from "@/app/admin/auction/players/players-table";
import { PlayerImportForm } from "@/app/admin/auction/players/player-import-form";
import { selectCurrentEdition } from "@/lib/event-edition";
import { getSettingsForEdition } from "@/lib/supabase/settings";

export const metadata: Metadata = { title: "Auction — Players" };

export default async function AdminAuctionPlayersPage() {
  const supabase = await createClient();

  const { data: edition } = await selectCurrentEdition(supabase);

  const [{ data: players }, { data: rounds }, { data: teams }, settings] = await Promise.all([
    edition
      ? supabase
          .from("players")
          .select("*")
          .eq("event_edition_id", edition.id)
          .order("pool")
          .order("full_name")
      : Promise.resolve({ data: [] }),
    edition
      ? supabase
          .from("rounds")
          .select("id, title")
          .eq("kind", "auction")
          .eq("event_edition_id", edition.id)
      : Promise.resolve({ data: [] }),
    edition
      ? supabase.from("teams").select("id, name").eq("event_edition_id", edition.id)
      : Promise.resolve({ data: [] }),
    edition
      ? getSettingsForEdition(edition.id, ["auction_franchise_assignments"])
      : Promise.resolve({ auction_franchise_assignments: {} as Record<string, string> }),
  ]);

  // This tab is now the players *record* — "who is in the pool and what
  // happened to them" — so a sold row has to say who bought them, under the
  // franchise alias the room used rather than the registered team name (same
  // reasoning as lib/auction/bidding-field.ts).
  const franchises = settings.auction_franchise_assignments ?? {};
  const teamLabels: Record<string, string> = {};
  for (const t of teams ?? []) {
    teamLabels[t.id as string] = franchises[t.id as string] ?? (t.name as string);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Auction — Players</h1>
        <p className="text-sm text-ink-2">
          AUC-01..07: the player record — pool, base price, status and who bought them. Put a player up for
          bidding from the Console&apos;s own search.
        </p>
      </div>

      {edition && (
        <PlayerImportForm eventEditionId={edition.id} roundId={rounds?.[0]?.id ?? null} />
      )}

      <PlayersTable
        players={players ?? []}
        teamLabels={teamLabels}
        eventEditionId={edition?.id ?? ""}
        roundId={rounds?.[0]?.id ?? null}
      />
    </div>
  );
}
