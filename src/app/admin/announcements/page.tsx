import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getAnnouncementsData } from "@/app/admin/announcements/actions";
import { AnnouncementsLive } from "@/app/admin/announcements/announcements-live";

export const metadata: Metadata = { title: "Announcements" };

export default async function AdminAnnouncementsPage() {
  const supabase = await createClient();
  const { data: edition } = await supabase.from("event_editions").select("id").eq("is_active", true).maybeSingle();

  const announcements = edition ? await getAnnouncementsData(edition.id) : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Announcements</h1>
        <p className="text-sm text-ink-2">
          Post a short announcement visible on every team&apos;s dashboard — use for schedule changes, round
          openings, or urgent corrections.
        </p>
      </div>
      {edition ? (
        <AnnouncementsLive eventEditionId={edition.id} initial={announcements} />
      ) : (
        <p className="text-sm text-ink-2">No active event edition.</p>
      )}
    </div>
  );
}
