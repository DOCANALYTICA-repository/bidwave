import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { selectLiveEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Registration complete" };

export default async function RegisterSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  // C1: registration no longer signs the captain in, so this page can't
  // read the team back via a session — the team name comes through as a
  // plain query param instead (not sensitive: it's the same name shown
  // publicly on the leaderboard/live tracker).
  const { team: teamName } = await searchParams;

  const supabase = await createClient();
  const { data: edition } = await selectLiveEdition(supabase);

  let whatsappLink: string | null = null;
  if (edition) {
    const { data: setting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "whatsapp_link")
      .eq("event_edition_id", edition.id)
      .maybeSingle();
    whatsappLink = (setting?.value as unknown as string) ?? null;
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-6 py-24 text-center">
      <BrandMark name="bidwave" height={48} />
      <CheckCircle2 className="size-12 text-sold" />
      <div>
        <h1 className="font-display text-2xl">You&apos;re in{teamName ? `, ${teamName}` : ""}!</h1>
        <p className="mt-2 text-sm text-ink-2">
          Your team account is active. Round 1 details will appear on your dashboard once
          released.
        </p>
      </div>

      {whatsappLink && (
        <div className="w-full space-y-2 rounded-xl border border-gold/30 bg-gold/5 p-4">
          <p className="font-heading text-sm font-semibold text-gold">
            Join the Bidwave WhatsApp group
          </p>
          <p className="text-xs text-ink-2">
            Every member of your team must join for updates and announcements.
          </p>
          <Button render={<a href={whatsappLink} target="_blank" rel="noopener noreferrer" />} className="w-full">
            Join on WhatsApp
          </Button>
        </div>
      )}

      <Button variant="outline" render={<Link href="/login" />} className="w-full">
        Log in to your dashboard
      </Button>
    </div>
  );
}
