import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { RuleSetForm } from "@/app/admin/auction/rules/rule-set-form";

export const metadata: Metadata = { title: "Auction — Rules" };

export default async function AdminAuctionRulesPage() {
  const supabase = await createClient();

  const { data: edition } = await supabase
    .from("event_editions")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  const [{ data: ruleSet }, { data: rounds }] = await Promise.all([
    edition
      ? supabase
          .from("auction_rule_sets")
          .select("*")
          .eq("event_edition_id", edition.id)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("rounds").select("id, title").eq("kind", "auction"),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Auction — Rules</h1>
        <p className="text-sm text-ink-2">
          §14.3 (DEP-06 placeholders below — admin replaces with real values, no code change).
        </p>
      </div>
      {edition && (
        <RuleSetForm
          ruleSet={ruleSet ?? null}
          eventEditionId={edition.id}
          roundId={rounds?.[0]?.id ?? null}
        />
      )}
    </div>
  );
}
