"use client";

import { useRouter } from "next/navigation";
import { ReconnectBanner } from "@/components/bidwave";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";

/**
 * Same ping-then-refetch idiom as every other live surface (principle #5):
 * the broadcast payload carries nothing private and is never read, it just
 * re-runs the server component so purses and rosters redraw as sales land.
 */
export function TrackerRealtime({ eventEditionId }: { eventEditionId: string }) {
  const router = useRouter();
  const { status } = useLiveBroadcast(eventEditionId, "auction", () => router.refresh());
  return <ReconnectBanner status={status} />;
}
