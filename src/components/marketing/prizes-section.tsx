import { EmptyState } from "@/components/bidwave";
import type { SettingsValue } from "@/lib/supabase/settings";

export function PrizesSection({ prizes }: { prizes?: SettingsValue<"prizes"> }) {
  if (!prizes || prizes.length === 0) {
    return (
      <EmptyState
        title="Prizes to be announced"
        description="Check back closer to the event for full prize details."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {prizes.map((p) => (
        <div key={p.place} className="rounded-xl border border-gold/30 bg-gold/5 p-6 text-center">
          <p className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
            {p.place}
          </p>
          <p className="mt-2 text-sm text-ink-2">{p.detail}</p>
        </div>
      ))}
    </div>
  );
}
