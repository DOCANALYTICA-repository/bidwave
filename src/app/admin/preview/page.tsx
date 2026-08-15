import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/bidwave";
import { enterPreview, prepareSimulationForPreview } from "@/app/admin/preview/actions";
import {
  PREVIEW_EDITION_SLUG,
  getPreviewSession,
  previewWindowOpen,
} from "@/lib/preview-mode";

export const metadata: Metadata = { title: "Preview" };
export const dynamic = "force-dynamic";

/**
 * Lets an admin rehearse the simulation, as themselves, against the
 * deployed site — same browser, same login, no separate team account.
 * Entering preview repoints every page this browser loads at the non-active
 * `e2e-test` edition (see src/lib/preview-mode.ts) and provisions a teams row
 * for the admin's own auth uid so submit_simulation_attempt has something to
 * reference.
 */
export default async function AdminPreviewPage() {
  await requireAdmin();

  const session = await getPreviewSession();
  const windowOpen = previewWindowOpen();

  const admin = createAdminClient();
  const { data: edition } = await admin
    .from("event_editions")
    .select("id, name, is_active")
    .eq("slug", PREVIEW_EDITION_SLUG)
    .maybeSingle();

  const { data: simConfig } = edition
    ? await admin
        .from("simulation_config")
        .select("visible_at, started_at")
        .eq("event_edition_id", edition.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl">Live rounds preview</h1>
        <p className="mt-1 text-sm text-ink-2">
          Play the simulation as yourself, on this deployed site, scoped to the{" "}
          <code>{PREVIEW_EDITION_SLUG}</code> edition — nothing here touches live data.
        </p>
      </div>

      {session && (
        <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-4 py-3 text-sm">
          <p className="font-semibold">This browser is currently in preview mode.</p>
          <p className="mt-1 text-ink-2">
            Every page you load — including this admin console — is scoped to{" "}
            <code>{session.slug}</code>.{" "}
            <a href="/api/preview/exit" className="text-gold underline underline-offset-4">
              Exit preview
            </a>
            .
          </p>
        </div>
      )}

      {!windowOpen && (
        <EmptyState
          title="Preview is switched off"
          description="BIDWAVE_PREVIEW_DISABLED_AFTER has passed. Preview cannot be entered — this is the event-week kill switch, and it is working as intended."
        />
      )}

      {windowOpen && !edition && (
        <EmptyState
          title={`The ${PREVIEW_EDITION_SLUG} edition doesn't exist yet`}
          description={`Run "npm run test:ensure-edition" locally against this database first.`}
        />
      )}

      {windowOpen && edition?.is_active && (
        <EmptyState
          title="Stop — the preview edition is marked active"
          description={`${PREVIEW_EDITION_SLUG} has is_active = true. Do not enter preview until that is corrected.`}
        />
      )}

      {windowOpen && edition && !edition.is_active && (
        <>
          <section className="space-y-4 rounded-lg border border-border p-4">
            <div>
              <h2 className="font-heading text-lg">1 · Prepare the simulation</h2>
              <p className="text-sm text-ink-2">
                Creates a simulation config for {PREVIEW_EDITION_SLUG} if one doesn&apos;t
                exist yet, then reveals and starts it. Safe to run again — it only fills in
                whatever step is missing.
              </p>
            </div>
            <p className="text-xs text-ink-3">
              Status:{" "}
              {!simConfig
                ? "not created"
                : `created · ${simConfig.visible_at ? "revealed" : "hidden"} · ${
                    simConfig.started_at ? "started" : "not started"
                  }`}
            </p>
            <form action={prepareSimulationForPreview}>
              <Button type="submit" variant="outline">
                Prepare simulation
              </Button>
            </form>
          </section>

          <section className="space-y-4 rounded-lg border border-border p-4">
            <div>
              <h2 className="font-heading text-lg">2 · Enter preview</h2>
              <p className="text-sm text-ink-2">
                Scopes this browser to {PREVIEW_EDITION_SLUG} and gives your own account a team
                row there. After this, <code>/app/simulation</code> lets you submit an attempt
                as yourself. Session lasts 2 hours.
              </p>
            </div>
            <form action={enterPreview}>
              <Button type="submit">{session ? "Refresh preview session" : "Enter preview"}</Button>
            </form>
          </section>

          <section className="space-y-2 rounded-lg border border-border p-4">
            <h2 className="font-heading text-lg">What preview does not cover</h2>
            <p className="text-sm text-ink-2">
              <strong>The auction is disabled in preview.</strong> The public live ticker
              reads a view that cannot be filtered by edition, so a rehearsal sale would
              appear publicly — recording, reversing, setting an active player, marking
              unsold and ending the auction all refuse while preview is on. Quiz rehearsal
              needs a real seeded team and isn&apos;t wired up here. Registration always
              writes to the live edition regardless of preview.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
