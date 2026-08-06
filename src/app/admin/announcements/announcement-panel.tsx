"use client";

import { useActionState, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/bidwave";
import {
  adminUpsertAnnouncement,
  adminSetAnnouncementVisibility,
  type AnnouncementActionState,
} from "@/app/admin/announcements/actions";

const initialState: AnnouncementActionState = { status: "idle" };

// Any server-rendered toLocaleString call needs an explicit locale/options
// — a zero-arg call produced a real hydration mismatch elsewhere in this
// codebase (console-sales-log.tsx), reproduced here during Phase 5 testing.
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

type Announcement = {
  id: string;
  audience: "all" | "team" | "public";
  message: string;
  visibility: "draft" | "published";
  created_at: string;
};

export function AnnouncementPanel({
  eventEditionId,
  announcements,
}: {
  eventEditionId: string;
  announcements: Announcement[];
}) {
  const [state, formAction, isPending] = useActionState(adminUpsertAnnouncement, initialState);
  const [audience, setAudience] = useState<"all" | "team" | "public">("all");
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.status === "success") {
      toast.success("Announcement saved.");
      queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
    }
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }

  return (
    <div className="space-y-8">
      <form action={formAction} className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
          New announcement
        </h2>
        <input type="hidden" name="announcementId" value="" />
        <input type="hidden" name="eventEditionId" value={eventEditionId} />
        <input type="hidden" name="audience" value={audience} />

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-ink-2">Audience</label>
          <Select value={audience} onValueChange={(v) => v && setAudience(v as typeof audience)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone (teams + public)</SelectItem>
              <SelectItem value="team">Teams only</SelectItem>
              <SelectItem value="public">Public only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-ink-2">Message</label>
          <Textarea name="message" required rows={3} placeholder="Round 3 has been rescheduled to 3:30pm." />
        </div>

        {state.status === "error" && state.formError && <p className="text-sm text-unsold">{state.formError}</p>}

        <div className="flex gap-2">
          <Button type="submit" name="visibility" value="draft" disabled={isPending}>
            Save as draft
          </Button>
          <Button type="submit" name="visibility" value="published" variant="outline" disabled={isPending}>
            Publish now
          </Button>
        </div>
      </form>

      <div className="space-y-2">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-ink-2">
          All announcements
        </h2>
        {announcements.length === 0 ? (
          <p className="text-sm text-ink-2">No announcements yet.</p>
        ) : (
          <ul className="space-y-2">
            {announcements.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <StatusPill status={a.visibility === "published" ? "purchased" : "locked"} label={a.visibility} />
                    <span className="text-xs uppercase text-ink-3">{a.audience}</span>
                    <span className="text-xs text-ink-3">{formatTimestamp(a.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-ink-2">{a.message}</p>
                  {toggleErrors[a.id] && <p className="mt-1 text-xs text-unsold">{toggleErrors[a.id]}</p>}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const nextVisibility = a.visibility === "published" ? "draft" : "published";
                    const { error } = await adminSetAnnouncementVisibility(
                      a.id,
                      eventEditionId,
                      a.audience,
                      a.message,
                      nextVisibility,
                    );
                    setToggleErrors((prev) => ({ ...prev, [a.id]: error ?? "" }));
                    if (error) {
                      toast.error(error);
                    } else {
                      toast.success(nextVisibility === "published" ? "Announcement published." : "Announcement unpublished.");
                      queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
                    }
                  }}
                >
                  {a.visibility === "published" ? "Unpublish" : "Publish"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
