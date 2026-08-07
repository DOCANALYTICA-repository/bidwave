"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-role";
import { selectCurrentEdition } from "@/lib/event-edition";
import type { Json } from "@/lib/supabase/types";

export type SettingsActionState = { status: "idle" | "error" | "success"; formError?: string };

// Mirrors src/lib/supabase/settings.ts's SETTINGS_SCHEMAS exactly — this is
// the write side of the same contract getSettings() reads back on the
// public site, so a shape mismatch here would silently corrupt what /,
// /faqs, /prizes read.
const SETTINGS_FORM_SCHEMA = z.object({
  whatsappLink: z.string().url("Must be a valid URL."),
  instagramUrl: z.string().url("Must be a valid URL."),
  registrationFeeAmount: z.coerce.number().nullable(),
  registrationFeeCurrency: z.string(),
  registrationFeeNote: z.string(),
  paymentInstructions: z.string(),
  prizes: z.array(z.object({ place: z.string().min(1), detail: z.string().min(1) })),
  faqs: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })),
  contacts: z.array(z.object({ name: z.string().min(1), role: z.string().min(1), phone: z.string().min(1) })),
  registrationOpensAt: z.string().nullable(),
  registrationClosesAt: z.string().nullable(),
});

export type SettingsFormValues = z.infer<typeof SETTINGS_FORM_SCHEMA>;

export async function getAdminSettingsData(): Promise<{
  eventEditionId: string | null;
  values: SettingsFormValues;
}> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition<{
    id: string;
    registration_opens_at: string | null;
    registration_closes_at: string | null;
  }>(supabase, "id, registration_opens_at, registration_closes_at");

  const defaults: SettingsFormValues = {
    whatsappLink: "",
    instagramUrl: "",
    registrationFeeAmount: null,
    registrationFeeCurrency: "INR",
    registrationFeeNote: "",
    paymentInstructions: "",
    prizes: [],
    faqs: [],
    contacts: [],
    registrationOpensAt: edition?.registration_opens_at ?? null,
    registrationClosesAt: edition?.registration_closes_at ?? null,
  };

  if (!edition) return { eventEditionId: null, values: defaults };

  const { data: rows } = await supabase
    .from("settings")
    .select("key, value")
    .eq("event_edition_id", edition.id);

  for (const row of rows ?? []) {
    const value = row.value as never;
    switch (row.key) {
      case "whatsapp_link":
        defaults.whatsappLink = value as string;
        break;
      case "instagram_url":
        defaults.instagramUrl = value as string;
        break;
      case "registration_fee": {
        const fee = value as { amount: number | null; currency: string; note: string };
        defaults.registrationFeeAmount = fee.amount;
        defaults.registrationFeeCurrency = fee.currency;
        defaults.registrationFeeNote = fee.note;
        break;
      }
      case "payment_instructions":
        defaults.paymentInstructions = value as string;
        break;
      case "prizes":
        defaults.prizes = value as SettingsFormValues["prizes"];
        break;
      case "faqs":
        defaults.faqs = value as SettingsFormValues["faqs"];
        break;
      case "contacts":
        defaults.contacts = value as SettingsFormValues["contacts"];
        break;
    }
  }

  return { eventEditionId: edition.id, values: defaults };
}

export async function adminSaveSettings(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireAdmin();

  let parsed: SettingsFormValues;
  try {
    parsed = SETTINGS_FORM_SCHEMA.parse({
      whatsappLink: formData.get("whatsappLink"),
      instagramUrl: formData.get("instagramUrl"),
      registrationFeeAmount: formData.get("registrationFeeAmount") || null,
      registrationFeeCurrency: formData.get("registrationFeeCurrency"),
      registrationFeeNote: formData.get("registrationFeeNote"),
      paymentInstructions: formData.get("paymentInstructions"),
      prizes: JSON.parse(String(formData.get("prizes") ?? "[]")),
      faqs: JSON.parse(String(formData.get("faqs") ?? "[]")),
      contacts: JSON.parse(String(formData.get("contacts") ?? "[]")),
      registrationOpensAt: formData.get("registrationOpensAt") || null,
      registrationClosesAt: formData.get("registrationClosesAt") || null,
    });
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message : "Invalid form data.";
    return { status: "error", formError: message };
  }

  // The regular admin-session client, not the service-role one — RLS's
  // settings_admin_write / event_editions_admin_write policies already
  // authorize this write for an admin JWT, so no new SECURITY DEFINER RPC
  // is needed for a plain key/value upsert.
  const supabase = await createClient();
  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return { status: "error", formError: "No active event edition found." };

  const rows: { event_edition_id: string; key: string; value: Json; is_public: boolean }[] = [
    { event_edition_id: edition.id, key: "whatsapp_link", value: parsed.whatsappLink, is_public: true },
    { event_edition_id: edition.id, key: "instagram_url", value: parsed.instagramUrl, is_public: true },
    {
      event_edition_id: edition.id,
      key: "registration_fee",
      value: {
        amount: parsed.registrationFeeAmount,
        currency: parsed.registrationFeeCurrency,
        note: parsed.registrationFeeNote,
      },
      is_public: true,
    },
    {
      event_edition_id: edition.id,
      key: "payment_instructions",
      value: parsed.paymentInstructions,
      is_public: true,
    },
    { event_edition_id: edition.id, key: "prizes", value: parsed.prizes, is_public: true },
    { event_edition_id: edition.id, key: "faqs", value: parsed.faqs, is_public: true },
    { event_edition_id: edition.id, key: "contacts", value: parsed.contacts, is_public: true },
  ];

  const { error: settingsError } = await supabase.from("settings").upsert(rows, { onConflict: "event_edition_id,key" });
  if (settingsError) return { status: "error", formError: settingsError.message };

  const { error: editionError } = await supabase
    .from("event_editions")
    .update({
      registration_opens_at: parsed.registrationOpensAt,
      registration_closes_at: parsed.registrationClosesAt,
    })
    .eq("id", edition.id);
  if (editionError) return { status: "error", formError: editionError.message };

  revalidatePath("/admin/settings");
  revalidatePath("/");
  revalidatePath("/faqs");
  revalidatePath("/prizes");
  revalidatePath("/register");
  return { status: "success" };
}
