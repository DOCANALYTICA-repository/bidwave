"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable, StatusPill } from "@/components/bidwave";
import type { MemberInput } from "@/lib/validation/registration";
import { TeamDetailSheet } from "@/app/admin/teams/team-detail-sheet";

// D2: at 100+ teams this table rendered every row's DOM at once, with no
// pagination at all — search still needs the full list client-side (it
// matches against team_members too, not just the visible columns), so
// this paginates the *rendered* slice rather than re-querying per page.
const PAGE_SIZE = 25;

export type AdminTeamRow = {
  id: string;
  name: string;
  campus: string;
  status: "active" | "disqualified";
  captain_email: string;
  created_at: string;
  updated_at: string;
  team_members: {
    id: string;
    full_name: string;
    class: string;
    register_number: string;
    phone: string;
    christ_email: string;
    is_captain: boolean;
  }[];
  invoices: { uploaded_at: string }[] | { uploaded_at: string } | null;
};

function hasInvoice(row: AdminTeamRow): boolean {
  return Array.isArray(row.invoices) ? row.invoices.length > 0 : row.invoices !== null;
}

function membersToInput(row: AdminTeamRow): MemberInput[] {
  return row.team_members
    .slice()
    .sort((a, b) => (b.is_captain ? 1 : 0) - (a.is_captain ? 1 : 0))
    .map((m) => ({
      fullName: m.full_name,
      className: m.class,
      registerNumber: m.register_number,
      phone: m.phone,
      christEmail: m.christ_email,
      isCaptain: m.is_captain,
    }));
}

export function TeamsTable({ teams }: { teams: AdminTeamRow[] }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AdminTeamRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => {
      if (t.name.toLowerCase().includes(q) || t.campus.toLowerCase().includes(q)) return true;
      return t.team_members.some(
        (m) =>
          m.full_name.toLowerCase().includes(q) ||
          m.register_number.toLowerCase().includes(q) ||
          m.christ_email.toLowerCase().includes(q),
      );
    });
  }, [teams, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search by team, campus, member name, register number or email…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
      />

      <DataTable
        rows={visible}
        rowKey={(r) => r.id}
        emptyTitle="No teams match your search"
        columns={[
          {
            key: "name",
            header: "Team",
            render: (r) => (
              <button
                type="button"
                onClick={() => setSelected(r)}
                className="cursor-pointer font-medium text-foreground hover:text-gold hover:underline"
              >
                {r.name}
              </button>
            ),
          },
          { key: "campus", header: "Campus", render: (r) => r.campus },
          { key: "members", header: "Members", render: (r) => r.team_members.length },
          { key: "captain", header: "Captain email", render: (r) => r.captain_email },
          {
            key: "invoice",
            header: "Invoice",
            render: (r) => (hasInvoice(r) ? <StatusPill status="sold" label="Uploaded" /> : <StatusPill status="unsold" label="Missing" />),
          },
          {
            key: "status",
            header: "Status",
            render: (r) =>
              r.status === "disqualified" ? (
                <StatusPill status="eliminated" label="Disqualified" />
              ) : (
                <StatusPill status="available" label="Active" />
              ),
          },
        ]}
      />

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-2">
          <span>
            Page {currentPage + 1} of {pageCount} · {filtered.length} team{filtered.length === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <TeamDetailSheet
        team={selected}
        initialMembers={selected ? membersToInput(selected) : []}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
