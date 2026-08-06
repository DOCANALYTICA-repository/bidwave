"use client";

import { useAdminLiveQuery } from "@/lib/realtime/use-admin-live-query";
import { AnnouncementPanel } from "@/app/admin/announcements/announcement-panel";
import { getAnnouncementsData, type Announcement } from "@/app/admin/announcements/actions";

export function AnnouncementsLive({
  eventEditionId,
  initial,
}: {
  eventEditionId: string;
  initial: Announcement[];
}) {
  const { data } = useAdminLiveQuery<Announcement[]>({
    queryKey: ["admin", "announcements", eventEditionId],
    queryFn: () => getAnnouncementsData(eventEditionId),
    initialData: initial,
    eventEditionId,
    topic: "announcements",
  });

  return <AnnouncementPanel eventEditionId={eventEditionId} announcements={data} />;
}
