import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/supabase/settings";
import { Hero } from "@/components/marketing/hero";
import { AboutSection } from "@/components/marketing/about-section";
import { GuidelinesSection } from "@/components/marketing/guidelines-section";
import { RoundsTeaser } from "@/components/marketing/rounds-teaser";
import { RegistrationCtaSection } from "@/components/marketing/registration-cta-section";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const [{ data: userResult }, { data: edition }, settings] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("event_editions")
      .select("id, registration_opens_at, registration_closes_at")
      .eq("is_active", true)
      .maybeSingle(),
    getSettings(["registration_fee"]),
  ]);

  const user = userResult.user;
  const dashboardHref = user
    ? user.app_metadata?.role === "admin"
      ? "/admin"
      : "/app"
    : undefined;

  let isOpen = false;
  if (edition) {
    const { data } = await supabase.rpc("is_registration_open", {
      p_event_edition_id: edition.id,
    });
    isOpen = !!data;
  }

  return (
    <>
      <Hero dashboardHref={dashboardHref} />
      <AboutSection />
      <GuidelinesSection />
      <RoundsTeaser />
      <RegistrationCtaSection
        isOpen={isOpen}
        fee={settings.registration_fee}
        dashboardHref={dashboardHref}
      />
    </>
  );
}
