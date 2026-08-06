"use client";

import { useRouter } from "next/navigation";
import { ReconnectBanner } from "@/components/bidwave";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";

export function LiveRealtime({ eventEditionId }: { eventEditionId: string }) {
  const router = useRouter();
  const { status } = useLiveBroadcast(eventEditionId, "auction", () => router.refresh());
  return <ReconnectBanner status={status} />;
}
