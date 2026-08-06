import { NextResponse } from "next/server";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { requireAdmin } from "@/lib/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  IMPORT_COLUMN_ALIASES,
  parseImportRow,
  type ImportRowError,
  type PlayerImportRow,
} from "@/lib/validation/auction";

// exceljs needs real Node Buffers — not available on the Edge runtime.
export const runtime = "nodejs";

/**
 * AUC-02/05: file uploads via a Route Handler (not a Server Action) —
 * mirrors the existing /api/quiz/submit precedent, gives a real JSON
 * response shape (inserted rows + a downloadable error report) instead of
 * a useActionState round trip. proxy.ts only gates /admin and /app path
 * prefixes, not /api/*, so requireAdmin() is called explicitly here —
 * the same accepted gap /api/quiz/submit already lives with.
 */
export async function POST(request: Request) {
  await requireAdmin();

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const eventEditionId = formData.get("eventEditionId") as string | null;
  const roundId = (formData.get("roundId") as string | null) || null;

  if (!file || !eventEditionId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  let rawRows: Record<string, unknown>[];
  try {
    rawRows = file.name.endsWith(".csv")
      ? await parseCsv(file)
      : await parseXlsx(file);
  } catch {
    return NextResponse.json({ error: "unparseable_file" }, { status: 400 });
  }

  const validRows: PlayerImportRow[] = [];
  const errors: ImportRowError[] = [];

  rawRows.forEach((raw, i) => {
    const aliased = aliasHeaders(raw);
    const result = parseImportRow(i + 2, aliased); // +2: header row is row 1
    if ("row" in result) validRows.push(result.row);
    else errors.push(...result.errors);
  });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_import_players", {
    p_event_edition_id: eventEditionId,
    p_round_id: roundId,
    p_rows: validRows,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const dbErrors = (data as { errors?: unknown[] })?.errors ?? [];
  const allErrors: ImportRowError[] = [
    ...errors,
    ...dbErrors.map((e) => {
      const row = e as { full_name?: string; external_ref?: string; error?: string };
      return {
        row_number: 0,
        field: "external_ref",
        message: row.error ?? "duplicate_external_ref",
        raw_value: row.full_name ?? row.external_ref ?? "",
      };
    }),
  ];

  const errorReportCsv =
    allErrors.length > 0
      ? Papa.unparse(allErrors, { columns: ["row_number", "field", "message", "raw_value"] })
      : null;

  return NextResponse.json({
    insertedCount: (data as { inserted_count?: number })?.inserted_count ?? 0,
    errors: allErrors,
    errorReportCsv,
  });
}

async function parseCsv(file: File): Promise<Record<string, unknown>[]> {
  const text = await file.text();
  const result = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
  return result.data;
}

async function parseXlsx(file: File): Promise<Record<string, unknown>[]> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled @types/node Buffer signature can drift from the
  // project's own — this is a type-only mismatch, the runtime value is a
  // real Buffer.
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];

  const headers: string[] = [];
  const rows: Record<string, unknown>[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell((cell, colNumber) => {
        headers[colNumber - 1] = String(cell.value ?? "").trim();
      });
      return;
    }
    const record: Record<string, unknown> = {};
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) record[header] = cell.value;
    });
    rows.push(record);
  });

  return rows;
}

/** Maps each raw header through IMPORT_COLUMN_ALIASES; unmapped headers pass through unchanged (become `stats`). */
function aliasHeaders(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = key.trim().toLowerCase();
    const mapped = IMPORT_COLUMN_ALIASES[normalized];
    out[mapped ?? key] = value;
  }
  return out;
}
