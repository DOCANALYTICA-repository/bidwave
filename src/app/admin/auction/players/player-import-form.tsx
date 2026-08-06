"use client";

import { useState } from "react";
import { FileDrop, EmptyState } from "@/components/bidwave";
import { Button } from "@/components/ui/button";

type ImportError = { row_number: number; field: string; message: string; raw_value: string };
type ImportResult = { insertedCount: number; errors: ImportError[]; errorReportCsv: string | null };

export function PlayerImportForm({
  eventEditionId,
  roundId,
}: {
  eventEditionId: string;
  roundId: string | null;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleImport() {
    if (files.length === 0) return;
    setIsPending(true);
    setResult(null);

    const formData = new FormData();
    formData.set("file", files[0]);
    formData.set("eventEditionId", eventEditionId);
    if (roundId) formData.set("roundId", roundId);

    try {
      const res = await fetch("/api/admin/auction/import-players", { method: "POST", body: formData });
      const data = await res.json();
      setResult(data);
      setFiles([]);
    } finally {
      setIsPending(false);
    }
  }

  function downloadErrorReport() {
    if (!result?.errorReportCsv) return;
    const blob = new Blob([result.errorReportCsv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "player-import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-gold">
          Import players
        </h2>
        <p className="text-sm text-ink-2">
          AUC-02/05: CSV or XLSX. Valid rows import immediately; invalid rows are listed below with a
          downloadable error report.
        </p>
      </div>
      <FileDrop value={files} onChange={setFiles} accept=".csv,.xlsx,.xls" multiple={false} disabled={isPending} />
      <Button onClick={handleImport} disabled={files.length === 0 || isPending}>
        {isPending ? "Importing…" : "Import"}
      </Button>

      {result && (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm text-sold">{result.insertedCount} player(s) imported.</p>
          {result.errors.length > 0 ? (
            <>
              <EmptyState
                title={`${result.errors.length} row(s) had errors`}
                description="Fix these rows and re-import, or download the report for reference."
              />
              <Button variant="outline" size="sm" onClick={downloadErrorReport}>
                Download error report
              </Button>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-ink-2">
                {result.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Row {e.row_number || "?"} · {e.field}: {e.message} ({e.raw_value})
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-ink-2">No errors.</p>
          )}
        </div>
      )}
    </div>
  );
}
