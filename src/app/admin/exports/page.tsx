import type { Metadata } from "next";

export const metadata: Metadata = { title: "Exports" };

const EXPORTS: { kind: string; label: string; description: string }[] = [
  { kind: "teams", label: "Teams", description: "Every registered team + its member roster (CSV)." },
  { kind: "submissions", label: "Submissions", description: "Current file set per team per submission round (CSV)." },
  {
    kind: "submission-files",
    label: "Submission files (bulk)",
    description: "Every current submitted file, organized by round/team, plus a manifest (ZIP).",
  },
  { kind: "scores", label: "Scores, aggregates & ranks", description: "Raw scores plus each stage's standing (XLSX, multi-sheet)." },
  { kind: "import-errors", label: "Player import errors", description: "Every rejected row from every player import run (CSV)." },
  { kind: "sales", label: "Sales, reversals, rosters & final squads", description: "Auction outcome, split across four sheets (XLSX)." },
  { kind: "activity", label: "Activity log", description: "Every activity_events row for this edition (CSV)." },
  { kind: "audit", label: "Auction audit trail", description: "The richest per-row auction audit trail (CSV)." },
];

/**
 * REP-01..07. Plain GET download links — each hits
 * /api/admin/exports/[kind], which streams a real CSV/XLSX file with
 * Content-Disposition rather than a JSON round trip.
 */
export default function AdminExportsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl">Exports</h1>
        <p className="text-sm text-ink-2">Download data for offline review, backup, or handover.</p>
      </div>
      <ul className="space-y-3">
        {EXPORTS.map((e) => (
          <li key={e.kind} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
            <div>
              <p className="font-heading text-sm font-semibold">{e.label}</p>
              <p className="text-xs text-ink-2">{e.description}</p>
            </div>
            <a
              href={`/api/admin/exports/${e.kind}`}
              className="rounded-lg bg-gold px-4 py-2 font-heading text-xs font-semibold uppercase tracking-wide text-primary-foreground hover:bg-gold-bright"
            >
              Download
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
