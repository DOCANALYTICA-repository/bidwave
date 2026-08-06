import Link from "next/link";
import { ROUND_COPY } from "@/lib/rounds-catalog";

const DAYS = [
  {
    label: "Online",
    dateLabel: "Dates announced separately",
    rounds: [ROUND_COPY["the-stat-sprint"], ROUND_COPY["operation-fan-heist"]],
  },
  {
    label: "Day 1",
    dateLabel: "17 August 2026",
    rounds: [ROUND_COPY["the-immersive-challenge"], ROUND_COPY["crisis-room"]],
  },
  {
    label: "Day 2",
    dateLabel: "18–19 August 2026",
    rounds: [ROUND_COPY["the-grand-auction"]],
  },
  {
    label: "Day 3",
    dateLabel: "19 August 2026 (afternoon)",
    rounds: [ROUND_COPY["the-owners-summit"]],
  },
];

export function ScheduleSection() {
  return (
    <div className="space-y-6">
      {DAYS.map((day) => (
        <div key={day.label} className="rounded-xl border border-border bg-card p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="font-display text-xl">{day.label}</h3>
            <span className="font-mono text-xs tabular-nums text-ink-3">{day.dateLabel}</span>
          </div>
          <ul className="space-y-2">
            {day.rounds.map((r) => (
              <li key={r.slug} className="flex items-center gap-3">
                <span className="font-mono text-xs tabular-nums text-gold">
                  {String(r.sequence).padStart(2, "0")}
                </span>
                <Link href={`/rounds/${r.slug}`} className="text-sm font-medium hover:text-gold">
                  {r.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
