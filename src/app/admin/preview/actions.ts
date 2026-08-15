"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PREVIEW_COOKIE,
  PREVIEW_EDITION_SLUG,
  PREVIEW_TTL_SECONDS,
  mintPreviewToken,
  provisionPreviewTeam,
} from "@/lib/preview-mode";

async function requirePreviewEdition() {
  const admin = createAdminClient();
  const { data: edition, error } = await admin
    .from("event_editions")
    .select("id, is_active")
    .eq("slug", PREVIEW_EDITION_SLUG)
    .maybeSingle();

  if (error || !edition) {
    throw new Error(
      `The ${PREVIEW_EDITION_SLUG} edition doesn't exist. Run "npm run test:ensure-edition" locally against this database first.`,
    );
  }
  // Belt-and-braces alongside the compile-time slug allowlist in
  // preview-mode.ts — a token can never name the live edition, but this
  // catches the underlying data itself ever being marked active.
  if (edition.is_active) {
    throw new Error(`${PREVIEW_EDITION_SLUG} is marked active — refusing to enter preview.`);
  }
  return { admin, edition };
}

/**
 * Enters preview mode for this browser and provisions a teams row for the
 * admin's own account, so they can open /app/simulation and submit as
 * themselves — no separate demo team or second browser profile involved.
 */
export async function enterPreview(): Promise<void> {
  const adminUser = await requireAdmin();
  if (!adminUser.email) {
    throw new Error("Admin account has no email on file — cannot provision a preview team.");
  }

  const { admin, edition } = await requirePreviewEdition();

  const token = mintPreviewToken();
  if (!token) {
    throw new Error("Preview is not configured (BIDWAVE_PREVIEW_SECRET unset) or the kill-switch window has closed.");
  }

  await provisionPreviewTeam(admin, edition.id, adminUser.id, adminUser.email);

  (await cookies()).set(PREVIEW_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PREVIEW_TTL_SECONDS,
  });

  revalidatePath("/", "layout");
  redirect("/admin/preview");
}

/**
 * One-click rehearsal setup: creates the simulation_config for the preview
 * edition if missing (round_id stays null — see seed_simulation_config's own
 * comment — so no stage-qualification gate ever applies to it), then reveals
 * and starts it. Idempotent: safe to click again on an edition that's
 * already prepared.
 */
export async function prepareSimulationForPreview(): Promise<void> {
  await requireAdmin();
  const { admin, edition } = await requirePreviewEdition();

  let { data: config } = await admin
    .from("simulation_config")
    .select("id, visible_at, started_at")
    .eq("event_edition_id", edition.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!config) {
    const { data: configId, error } = await admin.rpc("seed_simulation_config", {
      p_event_edition_id: edition.id,
    });
    if (error) throw error;
    config = { id: configId as string, visible_at: null, started_at: null };
  }

  if (!config.visible_at) {
    const { error } = await admin.rpc("admin_set_simulation_lifecycle", {
      p_config_id: config.id,
      p_action: "reveal",
    });
    if (error) throw error;
  }

  if (!config.started_at) {
    const { error } = await admin.rpc("admin_set_simulation_lifecycle", {
      p_config_id: config.id,
      p_action: "start",
    });
    if (error) throw error;
  }

  revalidatePath("/admin/preview");
}
