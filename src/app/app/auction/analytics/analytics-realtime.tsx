"use client";

import { useRouter } from "next/navigation";
import { ReconnectBanner } from "@/components/bidwave";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";

export function AnalyticsRealtime({ eventEditionId }: { eventEditionId: string }) {
  const router = useRouter();
  const { status } = useLiveBroadcast(eventEditionId, "analytics", () => router.refresh());
  return <ReconnectBanner status={status} />;
}
