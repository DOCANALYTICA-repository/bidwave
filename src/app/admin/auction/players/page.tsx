import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PlayersTable } from "@/app/admin/auction/players/players-table";
import { PlayerImportForm } from "@/app/admin/auction/players/player-import-form";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Auction — Players" };

export default async function AdminAuctionPlayersPage() {
  const supabase = await createClient();

  const { data: edition } = await selectCurrentEdition(supabase);

  const [{ data: players }, { data: rounds }] = await Promise.all([
    edition
      ? supabase
          .from("players")
          .select("*")
          .eq("event_edition_id", edition.id)
          .order("pool")
          .order("full_name")
      : Promise.resolve({ data: [] }),
    supabase.from("rounds").select("id, title").eq("kind", "auction"),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Auction — Players</h1>
        <p className="text-sm text-ink-2">AUC-01..07: import, add, and edit players.</p>
      </div>

      {edition && (
        <PlayerImportForm eventEditionId={edition.id} roundId={rounds?.[0]?.id ?? null} />
      )}

      <PlayersTable
        players={players ?? []}
        eventEditionId={edition?.id ?? ""}
        roundId={rounds?.[0]?.id ?? null}
      />
    </div>
  );
}
