import Link from "next/link";
import type { RoundCopy } from "@/lib/rounds-catalog";
import { StatusPill } from "@/components/bidwave";

export function RoundCard({
  copy,
  hasPublicMaterials,
}: {
  copy: RoundCopy;
  /**
   * Whether a real `rounds_with_status` row is visible to this (anon)
   * query — RLS only ever returns a row once `public_released_at` is set,
   * so the only two statuses an anonymous visitor can ever see are
   * 'publicly_released'/'archived'. There's nothing team-facing-status-
   * shaped worth showing here, just a simple "materials are out" signal.
   */
  hasPublicMaterials?: boolean;
}) {
  return (
    <Link
      href={`/rounds/${copy.slug}`}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-6 transition-colors hover:border-gold/40"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs tabular-nums text-ink-3">
          {String(copy.sequence).padStart(2, "0")}
        </span>
        {hasPublicMaterials && (
          <StatusPill status="scored" label="Materials released" />
        )}
      </div>
      <div>
        <h3 className="font-display text-xl group-hover:text-gold">{copy.name}</h3>
        <p className="font-heading text-xs uppercase tracking-wide text-ink-2">
          {copy.tagline}
        </p>
      </div>
      <p className="text-sm text-ink-2">{copy.summary}</p>
      <p className="mt-auto font-mono text-xs tabular-nums text-ink-3">{copy.dayLabel}</p>
    </Link>
  );
}
