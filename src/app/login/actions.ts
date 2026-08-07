"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIpKey } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation/auth";
import { selectCurrentEdition } from "@/lib/event-edition";

export type LoginActionState = {
  status: "idle" | "error";
  formError?: string;
};

export async function login(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const ip = await clientIpKey();
  // Generous — Supabase's own GoTrue rate limiting (config.toml
  // auth.rate_limit.sign_in_sign_ups) already covers the /token endpoint;
  // this is a second, coarser layer since we also log the attempt below.
  const withinLimit = await checkRateLimit("login", ip, 20, 900);
  if (!withinLimit) {
    return { status: "error", formError: "Too many attempts. Please wait a few minutes and try again." };
  }

  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!result.success) {
    return { status: "error", formError: "Enter a valid email and password." };
  }

  const admin = createAdminClient();
  const { data: edition } = await selectCurrentEdition(admin);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(result.data);

  if (error || !data.user) {
    // SEC-11-adjacent: don't reveal whether the email exists at all.
    if (edition) {
      await admin.rpc("log_activity", {
        p_event_edition_id: edition.id,
        p_team_id: null,
        p_actor_role: "public",
        p_kind: "login_failure",
      });
    }
    return { status: "error", formError: "Invalid email or password." };
  }

  const role = data.user.app_metadata?.role;
  if (edition) {
    await admin.rpc("log_activity", {
      p_event_edition_id: edition.id,
      p_team_id: role === "team" ? data.user.id : null,
      p_actor_role: role === "admin" ? "admin" : "team",
      p_kind: "login_success",
    });
  }

  redirect(role === "admin" ? "/admin" : "/app");
}
