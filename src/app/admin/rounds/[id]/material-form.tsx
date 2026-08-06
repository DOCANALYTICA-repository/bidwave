"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminSaveMaterial, type RoundActionState } from "@/app/admin/rounds/actions";

const roundActionInitialState: RoundActionState = { status: "idle" };

export function MaterialForm({ roundId }: { roundId: string }) {
  const [kind, setKind] = useState<"file" | "link" | "text">("text");
  const [publicRelease, setPublicRelease] = useState(false);
  const [state, formAction, isPending] = useActionState(adminSaveMaterial, roundActionInitialState);

  useEffect(() => {
    if (state.status === "success") toast.success("Material added.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state]);

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <input type="hidden" name="roundId" value={roundId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="position" value={0} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="material-title">Title</Label>
          <Input id="material-title" name="title" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="material-kind">Kind</Label>
          <Select value={kind} onValueChange={(v) => v && setKind(v as typeof kind)}>
            <SelectTrigger id="material-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="link">Link</SelectItem>
              <SelectItem value="file">File</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {kind === "text" && (
        <div className="space-y-1.5">
          <Label htmlFor="material-body">Body</Label>
          <Textarea id="material-body" name="body" rows={3} />
        </div>
      )}
      {kind === "link" && (
        <div className="space-y-1.5">
          <Label htmlFor="material-url">URL</Label>
          <Input id="material-url" name="url" type="url" />
        </div>
      )}
      {kind === "file" && (
        <div className="space-y-1.5">
          <Label htmlFor="material-file">File</Label>
          <input id="material-file" name="file" type="file" className="text-sm" />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          name="publicRelease"
          checked={publicRelease}
          onChange={(e) => setPublicRelease(e.target.checked)}
        />
        Publicly releasable once round is released
      </label>

      {state.status === "error" && state.formError && (
        <p className="text-xs text-unsold">{state.formError}</p>
      )}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Saving…" : "Add material"}
      </Button>
    </form>
  );
}
