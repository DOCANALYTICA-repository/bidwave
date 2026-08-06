import { NextResponse } from "next/server";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import * as archiverNs from "archiver";

// @types/archiver ships no callable signature for the module's actual
// runtime export (a factory function), only the Archiver/ZipArchive
// classes — this cast bridges that gap without losing type safety on the
// Archiver instance itself.
const archiver = archiverNs as unknown as (
  format: "zip",
  options?: archiverNs.ArchiverOptions,
) => archiverNs.Archiver;
import { PassThrough } from "node:stream";
import { requireAdmin } from "@/lib/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

// exceljs/archiver need real Node Buffers/streams, same reason as the
// player-import route.
export const runtime = "nodejs";

const EXPORT_KINDS = [
  "teams",
  "submissions",
  "submission-files",
  "scores",
  "import-errors",
  "sales",
  "activity",
  "audit",
] as const;
type ExportKind = (typeof EXPORT_KINDS)[number];

/**
 * REP-01..07. One Route Handler per export kind rather than a Server
 * Action — mirrors the import-players precedent: a real streamed file with
 * Content-Disposition, not a JSON round trip. proxy.ts doesn't cover
 * /api/*, so requireAdmin() is called explicitly (same accepted gap as
 * every other /api/admin/** route in this codebase).
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  await requireAdmin();
  const { kind } = await params;
  if (!EXPORT_KINDS.includes(kind as ExportKind)) {
    return NextResponse.json({ error: "unknown_export_kind" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: edition } = await admin.from("event_editions").select("id").eq("is_active", true).maybeSingle();
  if (!edition) {
    logger.error("export_failed", { kind, reason: "no_active_event_edition" });
    return NextResponse.json({ error: "no_active_event_edition" }, { status: 400 });
  }
  logger.info("export_requested", { kind, event_edition_id: edition.id });

  const today = new Date().toISOString().slice(0, 10);

  switch (kind as ExportKind) {
    case "teams":
      return csvResponse(await exportTeams(admin, edition.id), `bidwave-teams-${today}.csv`);
    case "submissions":
      return csvResponse(await exportSubmissions(admin, edition.id), `bidwave-submissions-${today}.csv`);
    case "submission-files":
      return zipResponse(
        await buildSubmissionFilesZip(admin, edition.id),
        `bidwave-submission-files-${today}.zip`,
      );
    case "import-errors":
      return csvResponse(await exportImportErrors(admin, edition.id), `bidwave-import-errors-${today}.csv`);
    case "activity":
      return csvResponse(await exportActivity(admin, edition.id), `bidwave-activity-${today}.csv`);
    case "audit":
      return csvResponse(await exportAudit(admin, edition.id), `bidwave-auction-audit-${today}.csv`);
    case "scores":
      return xlsxResponse(await exportScoresWorkbook(admin, edition.id), `bidwave-scores-${today}.xlsx`);
    case "sales":
      return xlsxResponse(await exportSalesWorkbook(admin, edition.id), `bidwave-sales-${today}.xlsx`);
  }
}

function csvResponse(rows: Record<string, unknown>[], filename: string) {
  const csv = rows.length > 0 ? Papa.unparse(rows) : "";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function zipResponse(zip: archiverNs.Archiver, filename: string) {
  const stream = new PassThrough();
  zip.pipe(stream);
  void zip.finalize();
  return new NextResponse(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

async function xlsxResponse(workbook: ExcelJS.Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function exportTeams(admin: AdminClient, eventEditionId: string) {
  const [{ data: teams }, { data: members }] = await Promise.all([
    admin.from("teams").select("id, name, campus, captain_email, status").eq("event_edition_id", eventEditionId),
    admin
      .from("team_members")
      .select("team_id, full_name, class, register_number, phone, christ_email, is_captain")
      .eq("event_edition_id", eventEditionId),
  ]);

  const membersByTeam = new Map<string, typeof members>();
  for (const m of members ?? []) {
    if (!membersByTeam.has(m.team_id)) membersByTeam.set(m.team_id, []);
    membersByTeam.get(m.team_id)!.push(m);
  }

  return (teams ?? []).map((t) => ({
    team_name: t.name,
    campus: t.campus,
    captain_email: t.captain_email,
    status: t.status,
    members: (membersByTeam.get(t.id) ?? [])
      .map((m) => `${m.full_name} (${m.register_number}${m.is_captain ? ", captain" : ""})`)
      .join("; "),
  }));
}

async function exportSubmissions(admin: AdminClient, eventEditionId: string) {
  const { data: rounds } = await admin
    .from("rounds")
    .select("id, title")
    .eq("event_edition_id", eventEditionId)
    .eq("kind", "submission");
  const roundIds = (rounds ?? []).map((r) => r.id);
  if (roundIds.length === 0) return [];

  const [{ data: submissions }, { data: teams }] = await Promise.all([
    admin
      .from("submissions")
      .select("round_id, team_id, status, submitted_at, submission_files(file_name, superseded_at)")
      .in("round_id", roundIds),
    admin.from("teams").select("id, name").eq("event_edition_id", eventEditionId),
  ]);

  const roundTitleById = new Map((rounds ?? []).map((r) => [r.id, r.title]));
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  return (submissions ?? []).map((s) => ({
    round: roundTitleById.get(s.round_id) ?? s.round_id,
    team: teamNameById.get(s.team_id) ?? s.team_id,
    status: s.status,
    submitted_at: s.submitted_at,
    current_files: (s.submission_files ?? [])
      .filter((f: { superseded_at: string | null }) => !f.superseded_at)
      .map((f: { file_name: string }) => f.file_name)
      .join("; "),
  }));
}

/**
 * Audit high-priority #14: exportSubmissions() above only ever produced a
 * metadata CSV (filenames, not file bytes) — never the bulk file archive
 * an admin actually needs to hand off submitted work for judging. This
 * downloads every current (non-superseded) submission file from the
 * private "submissions" bucket via the admin client and streams them into
 * one zip, organized by round/team, alongside a manifest CSV.
 */
async function buildSubmissionFilesZip(admin: AdminClient, eventEditionId: string) {
  const zip = archiver("zip", { zlib: { level: 9 } });

  const { data: rounds } = await admin
    .from("rounds")
    .select("id, title")
    .eq("event_edition_id", eventEditionId)
    .eq("kind", "submission");
  const roundIds = (rounds ?? []).map((r) => r.id);

  if (roundIds.length === 0) return zip;

  const [{ data: submissions }, { data: teams }] = await Promise.all([
    admin
      .from("submissions")
      .select("round_id, team_id, status, submitted_at, submission_files(storage_path, file_name, superseded_at)")
      .in("round_id", roundIds),
    admin.from("teams").select("id, name").eq("event_edition_id", eventEditionId),
  ]);

  const roundTitleById = new Map((rounds ?? []).map((r) => [r.id, r.title]));
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  const manifest: Record<string, unknown>[] = [];

  for (const s of submissions ?? []) {
    const roundTitle = (roundTitleById.get(s.round_id) ?? s.round_id) as string;
    const teamName = (teamNameById.get(s.team_id) ?? s.team_id) as string;
    const currentFiles = (s.submission_files ?? []).filter(
      (f: { superseded_at: string | null }) => !f.superseded_at,
    ) as { storage_path: string; file_name: string }[];

    if (currentFiles.length === 0) {
      manifest.push({ round: roundTitle, team: teamName, status: s.status, file: "" });
      continue;
    }

    for (const f of currentFiles) {
      const { data: blob, error } = await admin.storage.from("submissions").download(f.storage_path);
      manifest.push({ round: roundTitle, team: teamName, status: s.status, file: f.file_name, download_error: error?.message ?? "" });
      if (error || !blob) continue;

      const buffer = Buffer.from(await blob.arrayBuffer());
      zip.append(buffer, { name: `${sanitizeZipSegment(roundTitle)}/${sanitizeZipSegment(teamName)}/${f.file_name}` });
    }
  }

  zip.append(Papa.unparse(manifest), { name: "manifest.csv" });
  return zip;
}

function sanitizeZipSegment(segment: string): string {
  return segment.replace(/[/\\]/g, "-");
}

async function exportImportErrors(admin: AdminClient, eventEditionId: string) {
  const { data: events } = await admin
    .from("activity_events")
    .select("created_at, detail")
    .eq("event_edition_id", eventEditionId)
    .eq("kind", "players_imported")
    .order("created_at", { ascending: false });

  const rows: Record<string, unknown>[] = [];
  for (const e of events ?? []) {
    const detail = e.detail as { error_rows?: { external_ref?: string; full_name?: string; error?: string }[] };
    for (const err of detail?.error_rows ?? []) {
      rows.push({
        import_run_at: e.created_at,
        external_ref: err.external_ref ?? "",
        full_name: err.full_name ?? "",
        error: err.error ?? "",
      });
    }
  }
  return rows;
}

async function exportActivity(admin: AdminClient, eventEditionId: string) {
  const { data } = await admin
    .from("activity_events")
    .select("created_at, actor_role, kind, team_id, detail")
    .eq("event_edition_id", eventEditionId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((e) => ({
    created_at: e.created_at,
    actor_role: e.actor_role,
    kind: e.kind,
    team_id: e.team_id ?? "",
    detail: JSON.stringify(e.detail),
  }));
}

async function exportAudit(admin: AdminClient, eventEditionId: string) {
  const { data } = await admin
    .from("auction_audit_events")
    .select("created_at, kind, player_id, team_id, sale_id, actor_id, before_state, after_state, detail")
    .eq("event_edition_id", eventEditionId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((e) => ({
    created_at: e.created_at,
    kind: e.kind,
    player_id: e.player_id ?? "",
    team_id: e.team_id ?? "",
    sale_id: e.sale_id ?? "",
    actor_id: e.actor_id ?? "",
    before_state: JSON.stringify(e.before_state),
    after_state: JSON.stringify(e.after_state),
    detail: JSON.stringify(e.detail),
  }));
}

async function exportScoresWorkbook(admin: AdminClient, eventEditionId: string) {
  const workbook = new ExcelJS.Workbook();

  const { data: rounds } = await admin.from("rounds").select("id, title").eq("event_edition_id", eventEditionId);
  const { data: teams } = await admin.from("teams").select("id, name").eq("event_edition_id", eventEditionId);
  const { data: scores } = await admin
    .from("scores")
    .select("round_id, team_id, total, max_total, published")
    .in("round_id", (rounds ?? []).map((r) => r.id));

  const roundTitleById = new Map((rounds ?? []).map((r) => [r.id, r.title]));
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  const rawSheet = workbook.addWorksheet("Raw scores");
  rawSheet.columns = [
    { header: "Round", key: "round", width: 24 },
    { header: "Team", key: "team", width: 24 },
    { header: "Total", key: "total", width: 10 },
    { header: "Max total", key: "max_total", width: 10 },
    { header: "Published", key: "published", width: 10 },
  ];
  for (const s of scores ?? []) {
    rawSheet.addRow({
      round: roundTitleById.get(s.round_id) ?? s.round_id,
      team: teamNameById.get(s.team_id) ?? s.team_id,
      total: s.total,
      max_total: s.max_total,
      published: s.published,
    });
  }

  const { data: stages } = await admin.from("stages").select("id, code, label").eq("event_edition_id", eventEditionId);
  for (const stage of stages ?? []) {
    const { data: standings } = await admin.rpc("stage_standings", { p_stage_id: stage.id });
    const sheet = workbook.addWorksheet(`Stage — ${stage.code}`.slice(0, 31));
    sheet.columns = [
      { header: "Rank", key: "rank", width: 8 },
      { header: "Team", key: "team_name", width: 24 },
      { header: "Aggregate", key: "aggregate", width: 12 },
    ];
    for (const row of (standings as { team_name: string; aggregate: number; rank: number }[] | null) ?? []) {
      sheet.addRow(row);
    }
  }

  return workbook;
}

async function exportSalesWorkbook(admin: AdminClient, eventEditionId: string) {
  const workbook = new ExcelJS.Workbook();

  const [{ data: sales }, { data: players }, { data: teams }, { data: finalSnapshot }] = await Promise.all([
    admin
      .from("auction_sales")
      .select("player_id, team_id, amount, sold_at, reversed_at, reversal_reason")
      .eq("event_edition_id", eventEditionId),
    admin.from("players").select("id, full_name, role, pool, current_team_id, status").eq("event_edition_id", eventEditionId),
    admin.from("teams").select("id, name").eq("event_edition_id", eventEditionId),
    admin
      .from("leaderboard_snapshots")
      .select("id, leaderboard_snapshot_entries(team_name)")
      .eq("event_edition_id", eventEditionId)
      .eq("kind", "final_top_10")
      .is("hidden_at", null)
      .maybeSingle(),
  ]);

  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.full_name]));
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  const salesSheet = workbook.addWorksheet("Sales");
  salesSheet.columns = [
    { header: "Player", key: "player", width: 24 },
    { header: "Team", key: "team", width: 24 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Sold at", key: "sold_at", width: 24 },
  ];
  const reversalsSheet = workbook.addWorksheet("Reversals");
  reversalsSheet.columns = [
    { header: "Player", key: "player", width: 24 },
    { header: "Team", key: "team", width: 24 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Reversed at", key: "reversed_at", width: 24 },
    { header: "Reason", key: "reason", width: 32 },
  ];
  for (const s of sales ?? []) {
    const row = {
      player: playerNameById.get(s.player_id) ?? s.player_id,
      team: teamNameById.get(s.team_id) ?? s.team_id,
      amount: s.amount,
    };
    if (s.reversed_at) {
      reversalsSheet.addRow({ ...row, reversed_at: s.reversed_at, reason: s.reversal_reason });
    } else {
      salesSheet.addRow({ ...row, sold_at: s.sold_at });
    }
  }

  const rostersSheet = workbook.addWorksheet("Rosters");
  rostersSheet.columns = [
    { header: "Team", key: "team", width: 24 },
    { header: "Player", key: "player", width: 24 },
    { header: "Role", key: "role", width: 16 },
    { header: "Pool", key: "pool", width: 10 },
  ];
  for (const p of (players ?? []).filter((p) => p.status === "sold")) {
    rostersSheet.addRow({
      team: teamNameById.get(p.current_team_id ?? "") ?? "",
      player: p.full_name,
      role: p.role,
      pool: p.pool,
    });
  }

  // "Final squads" = rosters restricted to teams present in the currently
  // published final_top_10 snapshot — no snapshot yet means an empty sheet,
  // not an error.
  const finalTeamNames = new Set(
    (finalSnapshot?.leaderboard_snapshot_entries ?? []).map((e: { team_name: string }) => e.team_name),
  );
  const finalSquadsSheet = workbook.addWorksheet("Final squads");
  finalSquadsSheet.columns = [
    { header: "Team", key: "team", width: 24 },
    { header: "Player", key: "player", width: 24 },
    { header: "Role", key: "role", width: 16 },
    { header: "Pool", key: "pool", width: 10 },
  ];
  for (const p of (players ?? []).filter((p) => p.status === "sold")) {
    const teamName = teamNameById.get(p.current_team_id ?? "") ?? "";
    if (finalTeamNames.has(teamName)) {
      finalSquadsSheet.addRow({ team: teamName, player: p.full_name, role: p.role, pool: p.pool });
    }
  }

  return workbook;
}
