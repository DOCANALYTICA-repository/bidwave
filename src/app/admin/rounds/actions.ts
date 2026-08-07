"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { parseRpcErrorCode } from "@/lib/validation/registration";
import {
  roundFormSchema,
  materialFormSchema,
  rubricCriterionSchema,
  scoreFormSchema,
  ROUND_ERROR_FIELD,
} from "@/lib/validation/rounds";
import type { AdminRoundRow } from "@/app/admin/rounds/rounds-table";

export type RoundsQueryResult = {
  rounds: AdminRoundRow[];
  stages: { id: string; label: string }[];
  error: string | null;
};

/** Phase 5: shared by page.tsx's initial fetch and the client's React
 * Query cache (rounds-live.tsx), kept fresh via the 'rounds' broadcast_live()
 * topic instead of a manual nav or router.refresh(). */
export async function getRoundsData(): Promise<RoundsQueryResult> {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: rounds, error }, { data: stages }] = await Promise.all([
    supabase.from("rounds_with_status").select("*").order("sequence"),
    supabase.from("stages").select("id, label").order("code"),
  ]);
  return { rounds: rounds ?? [], stages: stages ?? [], error: error?.message ?? null };
}

export type RoundActionState = {
  status: "idle" | "error" | "success";
  fieldErrors?: Record<string, string[]>;
  formError?: string;
};

function fail(message: string, field?: string): RoundActionState {
  if (field && field !== "form") return { status: "error", fieldErrors: { [field]: [message] } };
  return { status: "error", formError: message };
}

function mapRpcError(message: string): RoundActionState {
  const parsed = parseRpcErrorCode(message);
  if (!parsed) return fail("Something went wrong. Please try again.");
  return fail(parsed.message, ROUND_ERROR_FIELD[parsed.code]);
}

export async function adminSaveRound(
  _prev: RoundActionState,
  formData: FormData,
): Promise<RoundActionState> {
  await requireAdmin();

  const raw = {
    roundId: (formData.get("roundId") as string) || null,
    expectedUpdatedAt: (formData.get("expectedUpdatedAt") as string) || null,
    kind: formData.get("kind"),
    sequence: formData.get("sequence"),
    slug: formData.get("slug"),
    title: formData.get("title"),
    brief: formData.get("brief"),
    instructions: formData.get("instructions"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
    requiresQualificationFromStage: formData.get("requiresQualificationFromStage"),
    rubricTotalMode: formData.get("rubricTotalMode") || "weighted_sum",
  };

  const result = roundFormSchema.safeParse(raw);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "form";
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return { status: "error", fieldErrors };
  }

  const admin = createAdminClient();
  const { data: edition } = await admin.from("event_editions").select("id").eq("is_active", true).maybeSingle();
  if (!edition) return fail("No active event edition found.");

  const { error } = await admin.rpc("admin_upsert_round", {
    p_round_id: result.data.roundId,
    p_expected_updated_at: result.data.expectedUpdatedAt,
    p_event_edition_id: edition.id,
    p_kind: result.data.kind,
    p_sequence: result.data.sequence,
    p_slug: result.data.slug,
    p_title: result.data.title,
    p_brief: result.data.brief || null,
    p_instructions: result.data.instructions || null,
    p_opens_at: result.data.opensAt || null,
    p_closes_at: result.data.closesAt || null,
    p_requires_qualification_from_stage: result.data.requiresQualificationFromStage || null,
    p_rubric_total_mode: result.data.rubricTotalMode,
  });

  if (error) return mapRpcError(error.message);

  revalidatePath("/admin/rounds");
  return { status: "success" };
}

export async function adminSetRoundLifecycle(roundId: string, action: string): Promise<RoundActionState> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_set_round_lifecycle", { p_round_id: roundId, p_action: action });
  if (error) return mapRpcError(error.message);
  revalidatePath("/admin/rounds");
  revalidatePath(`/admin/rounds/${roundId}`);
  return { status: "success" };
}

// E1: reopening a closed round is a narrow, audited exception to
// rounds_no_reopen — a mandatory reason and admin id, unlike every other
// lifecycle action above.
export async function adminReopenRound(roundId: string, reason: string): Promise<RoundActionState> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_set_round_lifecycle", {
    p_round_id: roundId,
    p_action: "reopen",
    p_admin_id: adminUser.id,
    p_reason: reason,
  });
  if (error) return mapRpcError(error.message);
  revalidatePath("/admin/rounds");
  revalidatePath(`/admin/rounds/${roundId}`);
  return { status: "success" };
}

export async function adminSaveMaterial(
  _prev: RoundActionState,
  formData: FormData,
): Promise<RoundActionState> {
  await requireAdmin();

  const result = materialFormSchema.safeParse({
    materialId: (formData.get("materialId") as string) || null,
    roundId: formData.get("roundId"),
    kind: formData.get("kind"),
    title: formData.get("title"),
    url: formData.get("url"),
    body: formData.get("body"),
    publicRelease: formData.get("publicRelease") === "on",
    position: formData.get("position") || 0,
  });

  if (!result.success) return fail(result.error.issues[0]?.message ?? "Invalid input.");

  const admin = createAdminClient();
  let storagePath: string | null = null;
  const file = formData.get("file") as File | null;
  if (result.data.kind === "file" && file && file.size > 0) {
    const path = `${result.data.roundId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await admin.storage
      .from("round-materials")
      .upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (uploadError) return fail("Upload failed. Please try again.");
    storagePath = path;
  }

  const { error } = await admin.rpc("admin_upsert_round_material", {
    p_material_id: result.data.materialId,
    p_round_id: result.data.roundId,
    p_kind: result.data.kind,
    p_title: result.data.title,
    p_storage_path: storagePath,
    p_url: result.data.url || null,
    p_body: result.data.body || null,
    p_public_release: result.data.publicRelease,
    p_position: result.data.position,
  });

  if (error) return mapRpcError(error.message);
  revalidatePath(`/admin/rounds/${result.data.roundId}`);
  return { status: "success" };
}

export async function adminDeleteMaterial(materialId: string, roundId: string): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.rpc("admin_delete_round_material", { p_material_id: materialId });
  revalidatePath(`/admin/rounds/${roundId}`);
}

export async function adminSaveRubricCriterion(
  _prev: RoundActionState,
  formData: FormData,
): Promise<RoundActionState> {
  await requireAdmin();

  const result = rubricCriterionSchema.safeParse({
    criterionId: (formData.get("criterionId") as string) || null,
    roundId: formData.get("roundId"),
    label: formData.get("label"),
    maxValue: formData.get("maxValue"),
    weight: formData.get("weight") || 1,
    position: formData.get("position") || 0,
  });

  if (!result.success) return fail(result.error.issues[0]?.message ?? "Invalid input.");

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_upsert_rubric_criterion", {
    p_criterion_id: result.data.criterionId,
    p_round_id: result.data.roundId,
    p_label: result.data.label,
    p_max_value: result.data.maxValue,
    p_weight: result.data.weight,
    p_position: result.data.position,
  });

  if (error) return mapRpcError(error.message);
  revalidatePath(`/admin/rounds/${result.data.roundId}`);
  return { status: "success" };
}

export async function adminDeleteRubricCriterion(criterionId: string, roundId: string): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.rpc("admin_delete_rubric_criterion", { p_criterion_id: criterionId });
  revalidatePath(`/admin/rounds/${roundId}`);
}

export async function adminSaveScore(
  _prev: RoundActionState,
  formData: FormData,
): Promise<RoundActionState> {
  const adminUser = await requireAdmin();

  const result = scoreFormSchema.safeParse({
    roundId: formData.get("roundId"),
    teamId: formData.get("teamId"),
    expectedUpdatedAt: (formData.get("expectedUpdatedAt") as string) || null,
    total: formData.get("total") || 0,
    maxTotal: formData.get("maxTotal") || undefined,
    // formData.get() returns null (not undefined) for a field that was
    // never set — score-row.tsx's form never includes a "notes" field at
    // all, so this was always null, and scoreFormSchema's `notes` only
    // accepts undefined/string/"" (not null), rejecting every real save
    // with a generic "Invalid input." Confirmed by direct e2e reproduction
    // that admin score-saving was completely broken as a result. The
    // sibling fields on this same line already normalize this way.
    notes: formData.get("notes") || undefined,
  });

  if (!result.success) return fail(result.error.issues[0]?.message ?? "Invalid input.");

  let criterionValues: unknown = null;
  const raw = formData.get("criterionValues");
  if (raw) {
    try {
      criterionValues = JSON.parse(String(raw));
    } catch {
      return fail("Invalid rubric values.");
    }
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_save_score", {
    p_round_id: result.data.roundId,
    p_team_id: result.data.teamId,
    p_expected_updated_at: result.data.expectedUpdatedAt,
    p_total: result.data.total,
    p_max_total: result.data.maxTotal ?? null,
    p_criterion_values: criterionValues as never,
    p_notes: result.data.notes || null,
    p_admin_id: adminUser.id,
  });

  if (error) return mapRpcError(error.message);
  revalidatePath(`/admin/rounds/${result.data.roundId}`);
  return { status: "success" };
}

export async function adminSetScorePublished(scoreId: string, roundId: string, published: boolean): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.rpc("admin_set_score_published", { p_score_id: scoreId, p_published: published });
  revalidatePath(`/admin/rounds/${roundId}`);
}

export async function adminPublishScoresForRound(roundId: string): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.rpc("admin_publish_scores_for_round", { p_round_id: roundId });
  revalidatePath(`/admin/rounds/${roundId}`);
}

export async function getSubmissionFileUrl(storagePath: string): Promise<string | null> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("submissions").createSignedUrl(storagePath, 60);
  if (error) return null;
  return data.signedUrl;
}
