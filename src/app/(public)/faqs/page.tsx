import type { Metadata } from "next";
import { getSettings } from "@/lib/supabase/settings";
import { FaqAccordion } from "@/components/marketing/faq-accordion";

export const metadata: Metadata = { title: "FAQs" };
export const dynamic = "force-dynamic";

export default async function FaqsPage() {
  const settings = await getSettings(["faqs"]);
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-16">
      <div className="text-center">
        <h1 className="font-display text-4xl">Frequently Asked Questions</h1>
      </div>
      <FaqAccordion faqs={settings.faqs} />
    </div>
  );
}
