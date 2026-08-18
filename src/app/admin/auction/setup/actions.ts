"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { selectCurrentEdition } from "@/lib/event-edition";
import {
  AUCTION_FRANCHISES,
  DEFAULT_PARTICIPANT_VISIBILITY,
  franchiseAssignmentsSchema,
  participantFieldVisibilitySchema,
  type FranchiseAssignments,
  type ParticipantFieldVisibility,
} from "@/lib/validation/auction";
import type { Json } from "@/lib/supabase/types";

export type SetupActionState = { status: "idle" | "error" | "success"; formError?: string };

export type AuctionSetupTeam = {
  id: string;
  name: string;
  campus: string;
  qualified: boolean;
};

export type AuctionSetupData = {
  eventEditionId: string | null;
  teams: AuctionSetupTeam[];
  assignments: FranchiseAssignments;
  visibility: ParticipantFieldVisibility;
};

/**
 * Franchise assignment and participant field visibility both live in the
 * `settings` key/value table rather than new columns — deliberately, so the
 * whole feature is reversible mid-event without a migration against the
 * live auction schema. Both keys are is_public: true; they describe what is
 * visible, they never contain player data.
 */
export async function getAuctionSetupData(): Promise<AuctionSetupData> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) {
    return {
      eventEditionId: null,
      teams: [],
      assignments: {},
      visibility: DEFAULT_PARTICIPANT_VISIBILITY,
    };
  }

  const [{ data: teams }, { data: quals }, { data: rows }] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, campus")
      .eq("event_edition_id", edition.id)
      .eq("status", "active")
      .order("name"),
    // Any 'qualified' decision at any stage marks a team as still alive —
    // used only to sort and label the picker, never to restrict it: the
    // admin may need to seat a team the stage data has not caught up with.
    supabase
      .from("qualifications")
      .select("team_id, decision, stages!inner(event_edition_id)")
      .eq("decision", "qualified")
      .eq("stages.event_edition_id", edition.id),
    supabase
      .from("settings")
      .select("key, value")
      .eq("event_edition_id", edition.id)
      .in("key", ["auction_franchise_assignments", "participant_field_visibility"]),
  ]);

  const qualifiedIds = new Set((quals ?? []).map((q) => q.team_id));

  let assignments: FranchiseAssignments = {};
  let visibility: ParticipantFieldVisibility = DEFAULT_PARTICIPANT_VISIBILITY;
  for (const row of rows ?? []) {
    if (row.key === "auction_franchise_assignments") {
      const parsed = franchiseAssignmentsSchema.safeParse(row.value);
      if (parsed.success) assignments = parsed.data;
    }
    if (row.key === "participant_field_visibility") {
      const parsed = participantFieldVisibilitySchema.safeParse(row.value);
      if (parsed.success) visibility = parsed.data;
    }
  }

  return {
    eventEditionId: edition.id,
    teams: (teams ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      campus: t.campus,
      qualified: qualifiedIds.has(t.id),
    })),
    assignments,
    visibility,
  };
}

const franchiseFormSchema = z.object({
  // franchise -> teamId ("" = unassigned). Inverted on write into the
  // teamId -> franchise shape the read side wants.
  pairs: z.array(z.object({ franchise: z.enum(AUCTION_FRANCHISES), teamId: z.string() })),
});

export async function adminSaveFranchiseAssignments(
  _prev: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  await requireAdmin();

  let pairs: z.infer<typeof franchiseFormSchema>["pairs"];
  try {
    pairs = franchiseFormSchema.parse({
      pairs: JSON.parse(String(formData.get("pairs") ?? "[]")),
    }).pairs;
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message : "Invalid form data.";
    return { status: "error", formError: message };
  }

  const assigned = pairs.filter((p) => p.teamId);

  // One franchise per team, and one team per franchise. The franchise side is
  // structurally unique (one row each); the team side is not, so it is the
  // one that actually needs guarding.
  const teamIds = assigned.map((p) => p.teamId);
  const duplicateTeam = teamIds.find((id, i) => teamIds.indexOf(id) !== i);
  if (duplicateTeam) {
    const clashing = assigned.filter((p) => p.teamId === duplicateTeam).map((p) => p.franchise);
    return {
      status: "error",
      formError: `One team cannot hold two franchises — assigned to both ${clashing.join(" and ")}.`,
    };
  }

  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return { status: "error", formError: "No active event edition found." };

  const value: Record<string, string> = {};
  for (const p of assigned) value[p.teamId] = p.franchise;

  const { error } = await supabase.from("settings").upsert(
    {
      event_edition_id: edition.id,
      key: "auction_franchise_assignments",
      value: value as Json,
      is_public: true,
    },
    { onConflict: "event_edition_id,key" },
  );
  if (error) return { status: "error", formError: error.message };

  // activity_events.kind is free-form text, so a new admin action is
  // auditable with no migration.
  const admin = createAdminClient();
  await admin.rpc("log_activity", {
    p_event_edition_id: edition.id,
    p_team_id: null,
    p_actor_role: "admin",
    p_kind: "auction_franchises_assigned",
    p_detail: { assigned_count: assigned.length } as Json,
  });

  revalidatePath("/admin/auction/setup");
  revalidatePath("/app/auction");
  revalidatePath("/live");
  return { status: "success" };
}

export async function adminSaveParticipantVisibility(
  _prev: SetupActionState,
  formData: FormData,
): Promise<SetupActionState> {
  await requireAdmin();

  const visibility: ParticipantFieldVisibility = {
    role: formData.get("role") === "on",
    base_price: formData.get("base_price") === "on",
    ipl_team: formData.get("ipl_team") === "on",
  };

  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return { status: "error", formError: "No active event edition found." };

  const { error } = await supabase.from("settings").upsert(
    {
      event_edition_id: edition.id,
      key: "participant_field_visibility",
      value: visibility as unknown as Json,
      is_public: true,
    },
    { onConflict: "event_edition_id,key" },
  );
  if (error) return { status: "error", formError: error.message };

  const admin = createAdminClient();
  await admin.rpc("log_activity", {
    p_event_edition_id: edition.id,
    p_team_id: null,
    p_actor_role: "admin",
    p_kind: "participant_visibility_changed",
    p_detail: visibility as unknown as Json,
  });

  revalidatePath("/admin/auction/setup");
  revalidatePath("/app/auction/players");
  return { status: "success" };
}
