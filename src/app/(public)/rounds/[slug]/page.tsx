import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROUND_COPY, type RoundSlug } from "@/lib/rounds-catalog";
import { EmptyState, StatusPill } from "@/components/bidwave";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const copy = ROUND_COPY[slug as RoundSlug];
  return { title: copy?.name ?? "Round" };
}

/**
 * PUB-02/03/§6.1: the About block is always the static brochure copy
 * (never `rounds.brief`/`instructions` — those are the admin's
 * authenticated working draft). Materials only render once RLS actually
 * returns the round row, which anon can only ever see once
 * `public_released_at` is set — the same query answers "does this round
 * exist yet" and "has it been released" in one shot.
 */
export default async function RoundDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const copy = ROUND_COPY[slug as RoundSlug];
  if (!copy) notFound();

  const supabase = await createClient();
  const { data: round } = await supabase
    .from("rounds_with_status")
    .select("id, status")
    .eq("slug", slug)
    .maybeSingle();

  let materials: {
    id: string;
    kind: string;
    title: string;
    url: string | null;
    body: string | null;
    storage_path: string | null;
    signedUrl?: string | null;
  }[] = [];

  if (round) {
    const { data } = await supabase
      .from("round_materials")
      .select("id, kind, title, url, body, storage_path")
      .eq("round_id", round.id)
      .order("position");

    materials = data ?? [];

    // Real gap: the submissions bucket's only select policy checks
    // (storage.foldername(name))[1] = auth.uid()::text, which a material
    // path (first segment is a round id, not a team id) can never match,
    // and there's no anon policy at all — so a publicly-released file
    // material would otherwise be undownloadable by anyone. RLS above
    // already confirmed public eligibility for this round; the admin
    // client here only mints a signed URL, it doesn't bypass any
    // authorization decision.
    const fileRows = materials.filter((m) => m.kind === "file" && m.storage_path);
    if (fileRows.length > 0) {
      const admin = createAdminClient();
      const signed = await Promise.all(
        fileRows.map((m) => admin.storage.from("submissions").createSignedUrl(m.storage_path!, 300)),
      );
      const urlByPath = new Map(
        fileRows.map((m, i) => [m.storage_path, signed[i].data?.signedUrl ?? null]),
      );
      materials = materials.map((m) =>
        m.kind === "file" ? { ...m, signedUrl: urlByPath.get(m.storage_path) } : m,
      );
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-6 py-16">
      <div className="space-y-3">
        <span className="font-mono text-xs tabular-nums text-ink-3">
          Round {copy.sequence}
        </span>
        <h1 className="font-display text-4xl">{copy.name}</h1>
        <p className="font-heading text-sm uppercase tracking-wide text-gold">{copy.tagline}</p>
        <p className="font-mono text-xs tabular-nums text-ink-3">{copy.dayLabel}</p>
      </div>

      <p className="text-ink-2">{copy.summary}</p>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
            Materials
          </h2>
          {round && <StatusPill status="scored" label="Released" />}
        </div>

        {!round || materials.length === 0 ? (
          <EmptyState
            title="Nothing to show yet"
            description={`Materials for ${copy.name} will be published here once the round has closed and scoring is complete.`}
          />
        ) : (
          <ul className="space-y-2">
            {materials.map((m) => (
              <li
                key={m.id}
                className="rounded-lg border border-border bg-card p-4 text-sm"
              >
                <p className="font-medium">{m.title}</p>
                {m.kind === "text" && <p className="mt-1 text-ink-2">{m.body}</p>}
                {m.kind === "link" && m.url && (
                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-gold underline">
                    {m.url}
                  </a>
                )}
                {m.kind === "file" && m.signedUrl && (
                  <a href={m.signedUrl} target="_blank" rel="noopener noreferrer" className="text-gold underline">
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
