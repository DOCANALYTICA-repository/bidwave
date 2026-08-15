"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIpKey } from "@/lib/rate-limit";
import {
  registrationDetailsSchema,
  invoiceUploadSchema,
  invoiceFileMetaSchema,
  INVOICE_ACCEPTED_MIME_TYPES,
  INVOICE_MAX_BYTES,
  parseRpcErrorCode,
  REGISTRATION_ERROR_FIELD,
} from "@/lib/validation/registration";
import { selectLiveEdition } from "@/lib/event-edition";
import {
  createUploadTarget,
  moveUploadedObject,
  removeUploadedObjects,
  verifyUploadedObject,
} from "@/lib/uploads/direct-upload";
import type { UploadTarget } from "@/lib/uploads/types";

export type RegisterActionState = {
  status: "idle" | "error";
  fieldErrors?: Record<string, string[]>;
  formError?: string;
};

/**
 * Staging directory for invoices uploaded before the captain's auth user
 * exists — nothing but service-role code can read it (the bucket's select
 * policy keys off the first path segment being a team's own auth uid), and
 * registerTeam() moves the object under that uid once it has one.
 */
const INVOICE_STAGING_DIR = "pending";

/**
 * Step 1 of registration's upload: the browser asks for a signed target,
 * PUTs the payment proof straight to Storage, then submits only the
 * resulting path with the rest of the form. Rate-limited on the same
 * budget as registration itself so this can't be used to fill the bucket.
 */
export async function createInvoiceUploadTarget(
  fileName: string,
  mimeType: string,
  size: number,
): Promise<{ target: UploadTarget } | { error: string }> {
  const ip = await clientIpKey();
  if (!(await checkRateLimit("register_upload", ip, 60, 3600))) {
    return { error: "Too many upload attempts from this connection. Please try again in an hour." };
  }

  const meta = invoiceFileMetaSchema.safeParse({ name: fileName, type: mimeType, size });
  if (!meta.success) {
    return { error: meta.error.issues[0]?.message ?? "That file can't be uploaded." };
  }

  const target = await createUploadTarget("invoices", INVOICE_STAGING_DIR, fileName);
  if (!target) return { error: "Could not start the upload. Please try again." };
  return { target };
}

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
  const invoiceResult = invoiceUploadSchema.safeParse({
    path: formData.get("invoicePath"),
    name: formData.get("invoiceFileName"),
    type: formData.get("invoiceMimeType"),
    size: Number(formData.get("invoiceSize") ?? 0),
  });

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

  // The browser uploaded the file itself, so its claimed size/type carry
  // no weight — this re-reads what actually landed in Storage, and refuses
  // any path outside the staging directory this server minted.
  const verified = await verifyUploadedObject("invoices", invoice.path, {
    expectedPrefix: INVOICE_STAGING_DIR,
    maxBytes: INVOICE_MAX_BYTES,
    allowedMimeTypes: INVOICE_ACCEPTED_MIME_TYPES,
  });

  if (!verified) {
    return {
      status: "error",
      fieldErrors: { invoiceFile: ["We couldn't read your payment proof. Please upload it again."] },
    };
  }

  // Every failure path below discards the staged upload: the client
  // re-uploads on each retry, so keeping it would leak one abandoned
  // object per rejected attempt (duplicate email, duplicate team name…).
  const discardStaged = async (state: RegisterActionState): Promise<RegisterActionState> => {
    await removeUploadedObjects("invoices", [invoice.path]);
    return state;
  };

  const serverClient = await createClient();
  const { data: edition, error: editionError } = await selectLiveEdition(serverClient);

  if (editionError || !edition) {
    return discardStaged({
      status: "error",
      formError: "No active event edition is configured. Please contact the organisers.",
    });
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
      return discardStaged({
        status: "error",
        fieldErrors: { members: ["This email is already registered to a team."] },
      });
    }
    return discardStaged({
      status: "error",
      formError: userError?.message ?? "Could not create the team account.",
    });
  }

  const authUserId = userData.user.id;

  // Same final path as before — the object just arrives by a move out of
  // the staging directory instead of a fresh server-side upload, so the
  // bucket's `foldername(name)[1] = auth.uid()` read policy still applies.
  const fileExt = invoice.name.includes(".") ? invoice.name.split(".").pop() : "bin";
  const storagePath = `${authUserId}/invoice.${fileExt}`;

  if (!(await moveUploadedObject("invoices", invoice.path, storagePath))) {
    await admin.auth.admin.deleteUser(authUserId);
    return discardStaged({
      status: "error",
      formError: "Could not save your payment proof. Please try again.",
    });
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
    p_invoice_mime_type: verified.contentType,
  });

  if (rpcError) {
    // Compensating actions — no orphaned auth user or uploaded file survives
    // a failed registration attempt.
    await admin.auth.admin.deleteUser(authUserId);
    await removeUploadedObjects("invoices", [storagePath]);

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
