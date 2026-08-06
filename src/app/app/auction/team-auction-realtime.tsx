"use client";

import { useRouter } from "next/navigation";
import { ReconnectBanner } from "@/components/bidwave";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";

/**
 * Invisible mount that subscribes to the auction broadcast topic and
 * refetches this team's own slice (a full page refresh, per principle #5 —
 * refetch through an authorized endpoint after a topic ping, never trust
 * the broadcast payload itself). Rendered as a small standalone client
 * component so the rest of /app/auction stays a plain Server Component.
 */
export function TeamAuctionRealtime({ eventEditionId }: { eventEditionId: string }) {
  const router = useRouter();
  const { status } = useLiveBroadcast(eventEditionId, "auction", () => router.refresh());
  return <ReconnectBanner status={status} />;
}
