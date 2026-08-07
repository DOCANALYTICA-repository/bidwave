"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIpKey } from "@/lib/rate-limit";
import {
  registrationDetailsSchema,
  invoiceFileSchema,
  parseRpcErrorCode,
  REGISTRATION_ERROR_FIELD,
} from "@/lib/validation/registration";
import { selectCurrentEdition } from "@/lib/event-edition";

export type RegisterActionState = {
  status: "idle" | "error";
  fieldErrors?: Record<string, string[]>;
  formError?: string;
};

/**
 * AT-REG-01..04: one server round-trip from the client's perspective, but
 * internally a three-system saga — Auth user creation, Storage upload and
 * the register_team() SQL transaction each belong to a different backend,
 * so true single-transaction atomicity is structurally impossible. Each
 * step after the first has an explicit compensating action on failure
 * (delete the auth user, remove the uploaded file) so a failed attempt
 * never leaves an orphaned account or file behind.
 */
export async function registerTeam(
  _prevState: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> {
  const ip = await clientIpKey();
  // D1: 8/hour/IP was tight enough to false-positive on a legitimate burst
  // of registrations from one shared network (e.g. campus WiFi/NAT) —
  // confirmed this is what a "100 registrations at once" load test hits
  // first, not a DB-level bottleneck. Raised to comfortably cover that
  // while still stopping scripted abuse.
  const withinLimit = await checkRateLimit("register", ip, 60, 3600);
  if (!withinLimit) {
    return {
      status: "error",
      formError: "Too many registration attempts from this connection. Please try again in an hour.",
    };
  }

  let membersParsed: unknown;
  try {
    membersParsed = JSON.parse(String(formData.get("members") ?? "[]"));
  } catch {
    return { status: "error", formError: "Invalid submission — please refresh and try again." };
  }

  const detailsResult = registrationDetailsSchema.safeParse({
    teamName: formData.get("teamName"),
    campus: formData.get("campus"),
    members: membersParsed,
    captainPassword: formData.get("captainPassword"),
    captainPasswordConfirm: formData.get("captainPasswordConfirm"),
  });
  const invoiceResult = invoiceFileSchema.safeParse(formData.get("invoiceFile"));

  if (!detailsResult.success || !invoiceResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of detailsResult.success ? [] : detailsResult.error.issues) {
      const key = issue.path.join(".") || "form";
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    if (!invoiceResult.success) {
      fieldErrors.invoiceFile = invoiceResult.error.issues.map((i) => i.message);
    }
    return { status: "error", fieldErrors };
  }

  const details = detailsResult.data;
  const invoice = invoiceResult.data;
  const captain = details.members.find((m) => m.isCaptain)!;

  const serverClient = await createClient();
  const { data: edition, error: editionError } = await selectCurrentEdition(serverClient);

  if (editionError || !edition) {
    return {
      status: "error",
      formError: "No active event edition is configured. Please contact the organisers.",
    };
  }

  const admin = createAdminClient();

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email: captain.christEmail,
    password: details.captainPassword,
    email_confirm: true, // REG-06/REG-08: no OTP/verification, activates immediately
    app_metadata: { role: "team" },
  });

  if (userError || !userData.user) {
    if (userError?.code === "email_exists") {
      return {
        status: "error",
        fieldErrors: { members: ["This email is already registered to a team."] },
      };
    }
    return { status: "error", formError: userError?.message ?? "Could not create the team account." };
  }

  const authUserId = userData.user.id;

  const fileExt = invoice.name.includes(".") ? invoice.name.split(".").pop() : "bin";
  const storagePath = `${authUserId}/invoice.${fileExt}`;

  const { error: uploadError } = await admin.storage
    .from("invoices")
    .upload(storagePath, invoice, { contentType: invoice.type, upsert: true });

  if (uploadError) {
    await admin.auth.admin.deleteUser(authUserId);
    return { status: "error", formError: "Could not upload your payment proof. Please try again." };
  }

  const { error: rpcError } = await admin.rpc("register_team", {
    p_auth_user_id: authUserId,
    p_event_edition_id: edition.id,
    p_team_name: details.teamName,
    p_campus: details.campus,
    p_members: details.members.map((m) => ({
      full_name: m.fullName,
      class: m.className,
      register_number: m.registerNumber,
      phone: m.phone,
      christ_email: m.christEmail,
      is_captain: m.isCaptain,
    })),
    p_invoice_storage_path: storagePath,
    p_invoice_file_name: invoice.name,
    p_invoice_mime_type: invoice.type,
  });

  if (rpcError) {
    // Compensating actions — no orphaned auth user or uploaded file survives
    // a failed registration attempt.
    await admin.auth.admin.deleteUser(authUserId);
    await admin.storage.from("invoices").remove([storagePath]);

    const parsed = parseRpcErrorCode(rpcError.message);
    if (!parsed) {
      return { status: "error", formError: "Registration failed. Please try again." };
    }
    const field = REGISTRATION_ERROR_FIELD[parsed.code] ?? "form";
    if (field === "form") {
      return { status: "error", formError: parsed.message };
    }
    return { status: "error", fieldErrors: { [field]: [parsed.message] } };
  }

  // C1: registration must NOT leave the browser with an authenticated
  // session — the captain has to log in explicitly afterward, same as any
  // returning team. This used to call serverClient.auth.signInWithPassword
  // right here, which meant "finish registering" and "logged in" happened
  // in the same request with no separate login step at all.
  redirect(`/register/success?team=${encodeURIComponent(details.teamName)}`);
}
