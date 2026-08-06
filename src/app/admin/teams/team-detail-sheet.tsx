"use client";

import { useActionState, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MemberRosterEditor } from "@/components/registration/member-roster-editor";
import { CHRIST_CAMPUSES, type MemberInput } from "@/lib/validation/registration";
import {
  adminUpdateTeam,
  adminResetPassword,
  getInvoiceSignedUrl,
  type AdminTeamActionState,
} from "@/app/admin/teams/actions";
import type { AdminTeamRow } from "@/app/admin/teams/teams-table";

// A "use server" file can only export async functions — the initial state
// literal has to live on the client side instead of alongside the action.
const adminTeamActionInitialState: AdminTeamActionState = { status: "idle" };

// Any server-rendered toLocaleString call needs an explicit locale/options
// — a zero-arg call produced a real hydration mismatch elsewhere in this
// codebase (console-sales-log.tsx; reproduced in this sheet's sibling
// admin pages during Phase 5 testing).
function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    hour12: false,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function TeamDetailSheet({
  team,
  initialMembers,
  onOpenChange,
}: {
  team: AdminTeamRow | null;
  initialMembers: MemberInput[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={!!team} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        {team && (
          // key={team.id} remounts this subtree when a different team is
          // selected, so every useState below re-initializes from the new
          // team's props automatically — no effect needed to reset them.
          <TeamDetailContent key={team.id} team={team} initialMembers={initialMembers} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TeamDetailContent({
  team,
  initialMembers,
}: {
  team: AdminTeamRow;
  initialMembers: MemberInput[];
}) {
  const [teamName, setTeamName] = useState(team.name);
  const [campus, setCampus] = useState(team.campus);
  const [members, setMembers] = useState<MemberInput[]>(initialMembers);
  const [updateState, updateAction, isUpdating] = useActionState(
    adminUpdateTeam,
    adminTeamActionInitialState,
  );

  const [newPassword, setNewPassword] = useState("");
  const [resetState, resetAction, isResetting] = useActionState(
    adminResetPassword,
    adminTeamActionInitialState,
  );

  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  const queryClient = useQueryClient();
  const [lastHandledUpdateState, setLastHandledUpdateState] = useState(updateState);
  if (updateState !== lastHandledUpdateState) {
    setLastHandledUpdateState(updateState);
    if (updateState.status === "success") {
      toast.success("Team details saved.");
      // The 'teams' broadcast_live() ping will also invalidate this, but
      // don't wait on the realtime round-trip for the admin's own edit.
      queryClient.invalidateQueries({ queryKey: ["admin", "teams"] });
    }
    if (updateState.status === "error" && updateState.formError) toast.error(updateState.formError);
  }

  const [lastHandledResetState, setLastHandledResetState] = useState(resetState);
  if (resetState !== lastHandledResetState) {
    setLastHandledResetState(resetState);
    if (resetState.status === "success") toast.success("Password updated.");
    if (resetState.status === "error" && resetState.formError) toast.error(resetState.formError);
  }

  function handleSave() {
    const fd = new FormData();
    fd.set("teamId", team.id);
    fd.set("expectedUpdatedAt", team.updated_at);
    fd.set("teamName", teamName);
    fd.set("campus", campus);
    fd.set("members", JSON.stringify(members));
    updateAction(fd);
  }

  async function handleViewInvoice() {
    setInvoiceLoading(true);
    const url = await getInvoiceSignedUrl(team.id);
    setInvoiceUrl(url);
    setInvoiceLoading(false);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      toast.error("Could not load the invoice.");
    }
  }

  function handleResetPassword() {
    const fd = new FormData();
    fd.set("teamId", team.id);
    fd.set("newPassword", newPassword);
    resetAction(fd);
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{team.name}</SheetTitle>
        <SheetDescription>Registered {formatTimestamp(team.created_at)}</SheetDescription>
      </SheetHeader>

      <Tabs defaultValue="details" className="flex-1 overflow-y-auto px-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="invoice">Invoice</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-6 pb-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-team-name">Team name</Label>
              <Input
                id="edit-team-name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                aria-invalid={!!updateState.fieldErrors?.teamName}
              />
              {updateState.fieldErrors?.teamName?.map((m) => (
                <p key={m} className="text-xs text-unsold">
                  {m}
                </p>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-campus">Campus</Label>
              <Select value={campus} onValueChange={(v) => v && setCampus(v)}>
                <SelectTrigger id="edit-campus" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHRIST_CAMPUSES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <MemberRosterEditor
            members={members}
            errors={updateState.fieldErrors ?? {}}
            onChange={setMembers}
          />

          {updateState.status === "error" && updateState.formError && (
            <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
              {updateState.formError}
            </p>
          )}
          {updateState.status === "success" && (
            <p className="rounded-lg border border-sold/30 bg-sold/10 px-3 py-2 text-sm text-sold">
              Saved.
            </p>
          )}

          <Button onClick={handleSave} disabled={isUpdating} className="w-full">
            {isUpdating ? "Saving…" : "Save changes"}
          </Button>
        </TabsContent>

        <TabsContent value="invoice" className="space-y-4 pb-4">
          <p className="text-sm text-ink-2">
            View the payment proof this team uploaded at registration.
          </p>
          <Button onClick={handleViewInvoice} disabled={invoiceLoading} variant="outline">
            {invoiceLoading ? "Loading…" : "Open invoice"}
          </Button>
          {invoiceUrl === null && !invoiceLoading && (
            <p className="text-xs text-ink-3">Click to generate a short-lived link.</p>
          )}
        </TabsContent>

        <TabsContent value="password" className="space-y-4 pb-4">
          <p className="text-sm text-ink-2">
            Sets a new password for the team&apos;s shared login ({team.captain_email}). No
            self-service reset exists — this is the only way to change it.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-invalid={!!resetState.fieldErrors?.newPassword}
            />
            {resetState.fieldErrors?.newPassword?.map((m) => (
              <p key={m} className="text-xs text-unsold">
                {m}
              </p>
            ))}
          </div>
          {resetState.status === "error" && resetState.formError && (
            <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
              {resetState.formError}
            </p>
          )}
          {resetState.status === "success" && (
            <p className="rounded-lg border border-sold/30 bg-sold/10 px-3 py-2 text-sm text-sold">
              Password updated.
            </p>
          )}
          <Button
            onClick={handleResetPassword}
            disabled={isResetting || newPassword.length < 8}
            variant="outline"
            className="w-full"
          >
            {isResetting ? "Updating…" : "Set new password"}
          </Button>
        </TabsContent>
      </Tabs>

      <SheetFooter />
    </>
  );
}
