"use client";

import { useRouter } from "next/navigation";
import { ReconnectBanner } from "@/components/bidwave";
import { useLiveBroadcast } from "@/lib/realtime/use-live-broadcast";

/**
 * The dashboard was previously plain force-dynamic SSR, so it only updated on
 * a manual reload — useless while an auction is running. Same ping-then-
 * refetch idiom as every other live surface: the broadcast payload is never
 * read, the server component simply re-runs.
 */
export function AdminAnalyticsRealtime({ eventEditionId }: { eventEditionId: string }) {
  const router = useRouter();
  const { status } = useLiveBroadcast(eventEditionId, "auction", () => router.refresh());
  return <ReconnectBanner status={status} />;
}
