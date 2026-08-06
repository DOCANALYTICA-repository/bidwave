"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { parseRpcErrorCode } from "@/lib/validation/registration";

export type AnnouncementActionState = { status: "idle" | "error" | "success"; formError?: string };

export type Announcement = {
  id: string;
  audience: "all" | "team" | "public";
  message: string;
  visibility: "draft" | "published";
  created_at: string;
};

/** Phase 5: shared by page.tsx's initial fetch and the client's React
 * Query cache (announcements-live.tsx), kept fresh via the
 * 'announcements' broadcast_live() topic instead of a manual nav. */
export async function getAnnouncementsData(eventEditionId: string): Promise<Announcement[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select("id, audience, message, visibility, created_at")
    .eq("event_edition_id", eventEditionId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Announcement[];
}

export async function adminUpsertAnnouncement(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const adminUser = await requireAdmin();

  const announcementId = (formData.get("announcementId") as string) || null;
  const eventEditionId = formData.get("eventEditionId") as string;
  const audience = formData.get("audience") as string;
  const message = (formData.get("message") as string)?.trim();
  const visibility = formData.get("visibility") as string;

  if (!message) return { status: "error", formError: "Message cannot be empty." };

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_upsert_announcement", {
    p_announcement_id: announcementId,
    p_event_edition_id: eventEditionId,
    p_audience: audience,
    p_message: message,
    p_visibility: visibility,
    p_admin_id: adminUser.id,
  });

  if (error) {
    const parsed = parseRpcErrorCode(error.message);
    return { status: "error", formError: parsed?.message ?? error.message };
  }

  revalidatePath("/admin/announcements");
  revalidatePath("/app");
  return { status: "success" };
}

export async function adminSetAnnouncementVisibility(
  announcementId: string,
  eventEditionId: string,
  audience: string,
  message: string,
  visibility: "draft" | "published",
): Promise<{ error?: string }> {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_upsert_announcement", {
    p_announcement_id: announcementId,
    p_event_edition_id: eventEditionId,
    p_audience: audience,
    p_message: message,
    p_visibility: visibility,
    p_admin_id: adminUser.id,
  });
  revalidatePath("/admin/announcements");
  revalidatePath("/app");
  return error ? { error: error.message } : {};
}
