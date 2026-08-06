"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { EmptyState } from "@/components/bidwave";
import type { SettingsValue } from "@/lib/supabase/settings";

export function FaqAccordion({ faqs }: { faqs?: SettingsValue<"faqs"> }) {
  if (!faqs || faqs.length === 0) {
    return <EmptyState title="No FAQs yet" description="Check back soon." />;
  }

  return (
    <Accordion multiple={false}>
      {faqs.map((f, i) => (
        <AccordionItem key={f.question} value={String(i)}>
          <AccordionTrigger>{f.question}</AccordionTrigger>
          <AccordionContent>
            <p className="text-ink-2">{f.answer}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
