"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import {
  adminUpdateTeamSchema,
  adminResetPasswordSchema,
} from "@/lib/validation/admin";
import { parseRpcErrorCode, REGISTRATION_ERROR_FIELD } from "@/lib/validation/registration";
import type { AdminTeamRow } from "@/app/admin/teams/teams-table";

export type TeamsQueryResult = { teams: AdminTeamRow[]; error: string | null };

/** Phase 5: the same query page.tsx used to run inline, now shared so the
 * client's React Query cache (teams-live.tsx) can re-run it directly as a
 * server action, kept fresh via the 'teams' broadcast_live() topic instead
 * of a manual nav or router.refresh(). */
export async function getTeamsData(eventEditionId: string): Promise<TeamsQueryResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .select(
      "id, name, campus, status, captain_email, created_at, updated_at, team_members(*), invoices(uploaded_at)",
    )
    .eq("event_edition_id", eventEditionId)
    .order("created_at", { ascending: false });

  return { teams: (data ?? []) as unknown as AdminTeamRow[], error: error?.message ?? null };
}

export type AdminTeamActionState = {
  status: "idle" | "error" | "success";
  fieldErrors?: Record<string, string[]>;
  formError?: string;
};

/** ADM-02 edit, ERR-07 stale-edit guard. */
export async function adminUpdateTeam(
  _prevState: AdminTeamActionState,
  formData: FormData,
): Promise<AdminTeamActionState> {
  await requireAdmin();

  let members: unknown;
  try {
    members = JSON.parse(String(formData.get("members") ?? "[]"));
  } catch {
    return { status: "error", formError: "Invalid submission." };
  }

  const result = adminUpdateTeamSchema.safeParse({
    teamId: formData.get("teamId"),
    expectedUpdatedAt: formData.get("expectedUpdatedAt"),
    teamName: formData.get("teamName"),
    campus: formData.get("campus"),
    members,
  });

  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "form";
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return { status: "error", fieldErrors };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_update_team", {
    p_team_id: result.data.teamId,
    p_expected_updated_at: result.data.expectedUpdatedAt,
    p_name: result.data.teamName,
    p_campus: result.data.campus,
    p_members: result.data.members.map((m) => ({
      full_name: m.fullName,
      class: m.className,
      register_number: m.registerNumber,
      phone: m.phone,
      christ_email: m.christEmail,
      is_captain: m.isCaptain,
    })),
  });

  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    if (!parsed) return { status: "error", formError: "Update failed. Please try again." };
    if (parsed.code === "stale_edit") {
      return { status: "error", formError: parsed.message };
    }
    const field = REGISTRATION_ERROR_FIELD[parsed.code] ?? "form";
    if (field === "form") return { status: "error", formError: parsed.message };
    return { status: "error", fieldErrors: { [field]: [parsed.message] } };
  }

  revalidatePath("/admin/teams");
  return { status: "success" };
}

/** §7.2: password reset is a manual admin action; no self-service flow. */
export async function adminResetPassword(
  _prevState: AdminTeamActionState,
  formData: FormData,
): Promise<AdminTeamActionState> {
  await requireAdmin();

  const result = adminResetPasswordSchema.safeParse({
    teamId: formData.get("teamId"),
    newPassword: formData.get("newPassword"),
  });
  if (!result.success) {
    return {
      status: "error",
      fieldErrors: { newPassword: result.error.issues.map((i) => i.message) },
    };
  }

  const admin = createAdminClient();
  const { data: team } = await admin
    .from("teams")
    .select("event_edition_id")
    .eq("id", result.data.teamId)
    .maybeSingle();

  const { error } = await admin.auth.admin.updateUserById(result.data.teamId, {
    password: result.data.newPassword,
  });

  if (error) {
    return { status: "error", formError: "Could not reset the password. Please try again." };
  }

  if (team) {
    await admin.rpc("log_activity", {
      p_event_edition_id: team.event_edition_id,
      p_team_id: result.data.teamId,
      p_actor_role: "admin",
      p_kind: "password_reset_by_admin",
    });
  }

  return { status: "success" };
}

/** SEC-04: short-lived signed URL, minted only after confirming the caller is admin. */
export async function getInvoiceSignedUrl(teamId: string): Promise<string | null> {
  await requireAdmin();

  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("invoices")
    .select("storage_path")
    .eq("team_id", teamId)
    .maybeSingle();

  if (!invoice) return null;

  const { data, error } = await admin.storage
    .from("invoices")
    .createSignedUrl(invoice.storage_path, 60);

  if (error) return null;
  return data.signedUrl;
}
