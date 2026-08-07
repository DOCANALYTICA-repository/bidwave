import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BackLink } from "@/components/bidwave";
import { SimulationConsole } from "@/app/app/simulation/simulation-console";
import { selectCurrentEdition } from "@/lib/event-edition";

export const metadata: Metadata = { title: "Simulation" };

export default async function TeamSimulationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // simulation_config has no team select policy (scoring/answer_key must
  // never reach a team via `select *`) — the admin client reads only the
  // public-safe `parameters` column here, never scoring/answer_key.
  const admin = createAdminClient();
  const { data: edition } = await selectCurrentEdition(admin);

  // C3: scoped to the active edition explicitly — previously the single
  // most-recently-created config was loaded with no edition filter at all,
  // ambiguous the moment a second config row ever existed.
  const { data: config } = await admin
    .from("simulation_config")
    .select("id, parameters, submit_cooldown_seconds, visible_at")
    .eq("event_edition_id", edition?.id ?? "")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // C2: visibility is independent of started_at/stopped_at — hidden by
  // default until an admin explicitly reveals it, regardless of whether
  // the simulation has otherwise started.
  if (!config || !config.visible_at) notFound();

  const { data: history } = await supabase
    .from("simulation_attempts")
    .select("id, overall, success, sub_scores, winner_rank, server_ts")
    .eq("config_id", config.id)
    .eq("team_id", user.id)
    .order("server_ts", { ascending: false });

  return (
    <div className="space-y-4 pt-6">
      <div className="mx-auto max-w-3xl px-6">
        <BackLink href="/app" label="Back to dashboard" />
      </div>
      <SimulationConsole
        configId={config.id}
        parameters={config.parameters as never}
        submitCooldownSeconds={config.submit_cooldown_seconds}
        history={(history ?? []) as never}
      />
    </div>
  );
}
