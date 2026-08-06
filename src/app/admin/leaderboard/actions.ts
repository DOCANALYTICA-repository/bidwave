"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";

export type LeaderboardQueryResult = {
  teams: { id: string; name: string }[];
  live: {
    id: string;
    published_at: string;
    hidden_at: string | null;
    leaderboard_snapshot_entries: { rank: number; team_name: string; score: number }[];
  } | null;
};

/** Phase 5: shared by page.tsx's initial fetch and the client's React
 * Query cache (leaderboard-live.tsx), kept fresh via the 'leaderboard'
 * broadcast_live() topic instead of a manual nav. */
export async function getLeaderboardData(eventEditionId: string): Promise<LeaderboardQueryResult> {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: teams }, { data: live }] = await Promise.all([
    supabase.from("teams").select("id, name").eq("event_edition_id", eventEditionId).order("name"),
    supabase
      .from("leaderboard_snapshots")
      .select("id, published_at, hidden_at, leaderboard_snapshot_entries(rank, team_name, score)")
      .eq("event_edition_id", eventEditionId)
      .eq("kind", "top_15")
      .is("hidden_at", null)
      .maybeSingle(),
  ]);
  return { teams: teams ?? [], live: live as LeaderboardQueryResult["live"] };
}

export async function adminPublishLeaderboard(
  kind: "top_15" | "final_top_10",
  entries: { rank: number; team_name: string; score: number }[],
  entryLimit: number,
): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { data: edition } = await admin.from("event_editions").select("id").eq("is_active", true).maybeSingle();
  if (!edition) return { error: "No active event edition." };
  const { error } = await admin.rpc("admin_publish_leaderboard", {
    p_event_edition_id: edition.id,
    p_kind: kind,
    p_entries: entries,
    p_entry_limit: entryLimit,
    p_admin_id: adminUser.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/leaderboard");
  revalidatePath("/leaderboard");
  return {};
}

export async function adminHideLeaderboard(snapshotId: string): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.rpc("admin_hide_leaderboard", { p_snapshot_id: snapshotId });
  revalidatePath("/admin/leaderboard");
  revalidatePath("/leaderboard");
}
