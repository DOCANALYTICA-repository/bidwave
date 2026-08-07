import type { Metadata } from "next";
import { getAdminSettingsData } from "@/app/admin/settings/actions";
import { SettingsForm } from "@/app/admin/settings/settings-form";

export const metadata: Metadata = { title: "Settings" };

/**
 * Phase 5: prizes/FAQs/contacts/payment copy/WhatsApp+Instagram links and
 * the registration window were previously editable only in Supabase
 * Studio directly, despite src/lib/supabase/settings.ts's own comment
 * claiming "admin-editable with no code change" — there was never an
 * admin UI for it. This is that UI.
 */
export default async function AdminSettingsPage() {
  const { eventEditionId, values } = await getAdminSettingsData();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Settings</h1>
        <p className="text-sm text-ink-2">
          Public site content — prizes, FAQs, contacts, payment details and links — plus the registration window.
          Changes are live immediately, no deploy required.
        </p>
      </div>
      {eventEditionId ? (
        <SettingsForm initial={values} />
      ) : (
        <p className="text-sm text-ink-2">No active event edition.</p>
      )}
    </div>
  );
}
