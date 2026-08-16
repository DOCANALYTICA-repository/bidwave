"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { selectCurrentEdition } from "@/lib/event-edition";

/**
 * Chronological stage order. `code` sorts alphabetically to final, r1_r2,
 * r3_r4, r6 — which puts the Final first, ahead of the rounds that feed it.
 * There is no sequence column on stages (the vocabulary is closed and fixed
 * by a CHECK constraint), so the running order lives here.
 */
const STAGE_ORDER = ["r1_r2", "r3_r4", "r6", "final"];

function byStageOrder(a: { code: string }, b: { code: string }) {
  return STAGE_ORDER.indexOf(a.code) - STAGE_ORDER.indexOf(b.code);
}

export type StagesQueryResult = {
  stages: { id: string; code: string; label: string }[];
  rounds: { id: string; title: string; kind: string; sequence: number }[];
  stageRounds: { stage_id: string; round_id: string; weight: number }[];
};

/** Phase 5: shared by page.tsx's initial fetch and the client's React
 * Query cache (stages-live.tsx), kept fresh via the 'stages' broadcast_live()
 * topic instead of a manual nav. */
export async function getStagesData(): Promise<StagesQueryResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  const [{ data: stages }, { data: rounds }, { data: stageRounds }] = await Promise.all([
    // Scoped to the current edition — stages are unique per (edition, code),
    // so an unfiltered select returns the e2e-test edition's four stages
    // alongside the real ones and every stage renders twice.
    edition
      ? supabase.from("stages").select("id, code, label").eq("event_edition_id", edition.id)
      : Promise.resolve({ data: [] }),
    edition
      ? supabase
          .from("rounds")
          .select("id, title, kind, sequence")
          .eq("event_edition_id", edition.id)
          .order("sequence")
      : Promise.resolve({ data: [] }),
    supabase.from("stage_rounds").select("stage_id, round_id, weight"),
  ]);
  return {
    stages: (stages ?? []).slice().sort(byStageOrder),
    rounds: rounds ?? [],
    stageRounds: stageRounds ?? [],
  };
}

export async function getStageStandings(stageId: string) {
  await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("stage_standings", { p_stage_id: stageId });
  if (error) return [];
  return data ?? [];
}

export async function adminSetStageRounds(
  stageId: string,
  roundWeights: { round_id: string; weight: number }[],
): Promise<{ error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_set_stage_rounds", {
    p_stage_id: stageId,
    p_round_weights: roundWeights,
  });
  revalidatePath("/admin/stages");
  return error ? { error: error.message } : {};
}

export async function adminConfirmQualifications(
  stageId: string,
  decisions: { team_id: string; decision: string }[],
): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_confirm_qualifications", {
    p_stage_id: stageId,
    p_decisions: decisions,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/stages");
  return error ? { error: error.message } : {};
}
