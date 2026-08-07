import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { selectCurrentEdition } from "@/lib/event-edition";

/**
 * PUB-08: landing-page content that must be admin-editable with no code
 * change lives in the `settings` table (migration 001). Each key has its
 * own Zod shape here so a malformed value degrades to "key absent" for the
 * caller instead of throwing — a public page should never 500 because an
 * admin typed a bad JSON value into Supabase Studio.
 */
const SETTINGS_SCHEMAS = {
  whatsapp_link: z.string().url(),
  registration_fee: z.object({
    amount: z.number().nullable(),
    currency: z.string(),
    note: z.string(),
  }),
  payment_instructions: z.string(),
  prizes: z.array(z.object({ place: z.string(), detail: z.string() })),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
  contacts: z.array(
    z.object({ name: z.string(), role: z.string(), phone: z.string() }),
  ),
  instagram_url: z.string().url(),
} as const;

export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
export type SettingsValue<K extends SettingsKey> = z.infer<
  (typeof SETTINGS_SCHEMAS)[K]
>;

/**
 * Fetches the given settings keys scoped to the currently active event
 * edition. Two round-trips (active edition, then settings) rather than a
 * PostgREST embedded filter — simpler to reason about and matches this
 * project's existing `Promise.all`-of-plain-queries idiom (see
 * register/success/page.tsx) rather than a nested-resource query shape
 * nothing else in the codebase uses yet.
 */
export async function getSettings<K extends SettingsKey>(
  keys: readonly K[],
): Promise<{ [P in K]?: SettingsValue<P> }> {
  const supabase = await createClient();
  const result: Partial<Record<SettingsKey, unknown>> = {};

  const { data: edition } = await selectCurrentEdition(supabase);
  if (!edition) return result as { [P in K]?: SettingsValue<P> };

  const { data: rows } = await supabase
    .from("settings")
    .select("key, value")
    .eq("event_edition_id", edition.id)
    .in("key", keys as unknown as string[]);

  for (const row of rows ?? []) {
    const schema = SETTINGS_SCHEMAS[row.key as SettingsKey];
    if (!schema) continue;
    const parsed = schema.safeParse(row.value);
    if (parsed.success) result[row.key as SettingsKey] = parsed.data;
  }

  return result as { [P in K]?: SettingsValue<P> };
}
