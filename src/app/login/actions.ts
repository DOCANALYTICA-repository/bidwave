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

const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a few minutes and try again.";

export async function login(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const ip = await clientIpKey();

  // Two tiers, deliberately. The venue puts 80+ captains behind one NAT, so
  // a single IP-keyed bucket meant the 21st sign-in of the morning locked
  // out everyone on that network. This coarse ceiling exists only to stop an
  // automated stuffing run (thousands of attempts), not to pace humans —
  // Supabase's own GoTrue limiting (config.toml auth.rate_limit
  // .sign_in_sign_ups) still covers the /token endpoint underneath.
  // Checked before parsing so a malformed flood stays cheap to reject.
  const withinIpCeiling = await checkRateLimit("login_ip", ip, 600, 900);
  if (!withinIpCeiling) {
    return { status: "error", formError: TOO_MANY_ATTEMPTS };
  }

  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!result.success) {
    return { status: "error", formError: "Enter a valid email and password." };
  }

  // The bucket that actually deters credential stuffing: per account, per
  // IP. loginSchema already trims and lowercases the email, so the key is
  // normalised for free and `Foo@X` can't open a second bucket. Keying on
  // the email rather than the IP alone is also strictly better against
  // lockout — an attacker fills only their own bucket and can't shut a
  // captain out from a different address.
  const withinAccountLimit = await checkRateLimit("login", `${result.data.email}:${ip}`, 10, 900);
  if (!withinAccountLimit) {
    return { status: "error", formError: TOO_MANY_ATTEMPTS };
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
