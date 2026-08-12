import { z } from "zod";

/**
 * Shared client + server validation for /register (REG-01..12, §7.3).
 * The server action re-runs this exact schema before touching Supabase —
 * client-side validation here is UX only; the server is the authority.
 */

export const CHRIST_CAMPUSES = ["Bannerghatta Road", "Central", "Yeshwanthpur"] as const;

const CHRIST_EMAIL_SUFFIX = ".christuniversity.in";

const christEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .refine(
    (v) => v.endsWith(CHRIST_EMAIL_SUFFIX),
    `Must be a CHRIST University address ending in ${CHRIST_EMAIL_SUFFIX}`,
  );

export const memberSchema = z.object({
  fullName: z.string().trim().min(1, "Required").max(120),
  className: z.string().trim().min(1, "Required").max(60),
  registerNumber: z.string().trim().min(1, "Required").max(40),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a valid phone number")
    .max(20)
    .regex(/^[0-9+\-\s()]+$/, "Enter a valid phone number"),
  christEmail: christEmailSchema,
  isCaptain: z.boolean(),
});

export type MemberInput = z.infer<typeof memberSchema>;

// REG-02: exactly three required, a fourth optional (§7.3).
export const membersArraySchema = z
  .array(memberSchema)
  .min(3, "At least 3 members are required")
  .max(4, "At most 4 members are allowed")
  .refine(
    (members) => members.filter((m) => m.isCaptain).length === 1,
    { message: "Exactly one member must be marked as captain" },
  )
  .refine(
    (members) => {
      const emails = members.map((m) => m.christEmail);
      return new Set(emails).size === emails.length;
    },
    { message: "Each member must have a different email" },
  )
  .refine(
    (members) => {
      const regNos = members.map((m) => m.registerNumber.toLowerCase());
      return new Set(regNos).size === regNos.length;
    },
    { message: "Each member must have a different register number" },
  );

export const registrationDetailsSchema = z
  .object({
    teamName: z.string().trim().min(2, "At least 2 characters").max(80),
    campus: z.enum(CHRIST_CAMPUSES, { message: "Select a campus" }),
    members: membersArraySchema,
    captainPassword: z.string().min(8, "At least 8 characters").max(72),
    captainPasswordConfirm: z.string(),
  })
  .refine((data) => data.captainPassword === data.captainPasswordConfirm, {
    message: "Passwords do not match",
    path: ["captainPasswordConfirm"],
  });

export type RegistrationDetailsInput = z.infer<typeof registrationDetailsSchema>;

// REG-07: PDF, JPG or PNG. 10MB is a friendly guard for a payment
// screenshot/receipt, well under the Storage bucket's own ceiling — not a
// silent app-level cap masquerading as the real limit (ERR-02).
export const INVOICE_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
export const INVOICE_MAX_BYTES = 10 * 1024 * 1024;

export const invoiceFileSchema = z
  .instanceof(File, { message: "Upload your payment proof" })
  .refine((f) => f.size > 0, "The uploaded file is empty")
  .refine(
    (f) => f.size <= INVOICE_MAX_BYTES,
    `File must be ${INVOICE_MAX_BYTES / (1024 * 1024)}MB or smaller`,
  )
  .refine(
    (f) => (INVOICE_ACCEPTED_MIME_TYPES as readonly string[]).includes(f.type),
    "Accepted formats: PDF, JPG, PNG",
  );

/**
 * The same three rules as `invoiceFileSchema`, expressed over plain
 * metadata. The payment proof now goes browser → Storage directly (see
 * `lib/uploads/direct-upload.ts`), so the server sees a description of the
 * file when minting the upload target, never a `File` — and re-reads the
 * object's real size and MIME type from Storage afterward, which is the
 * check that actually binds.
 */
export const invoiceFileMetaSchema = z.object({
  name: z.string().trim().min(1, "Upload your payment proof").max(255),
  type: z.enum(INVOICE_ACCEPTED_MIME_TYPES, { message: "Accepted formats: PDF, JPG, PNG" }),
  size: z
    .number()
    .int()
    .positive("The uploaded file is empty")
    .max(INVOICE_MAX_BYTES, `File must be ${INVOICE_MAX_BYTES / (1024 * 1024)}MB or smaller`),
});

/** What the register form submits in place of the file itself. */
export const invoiceUploadSchema = invoiceFileMetaSchema.extend({
  path: z.string().trim().min(1, "Upload your payment proof"),
});

/**
 * Server-side error codes raised by register_team() — see migration
 * 002's `raise exception '[code] message'` convention. Mapped to the form
 * field that should show the error (ERR-01: actionable, field-level,
 * without clearing other fields).
 */
export const REGISTRATION_ERROR_FIELD: Record<string, string> = {
  registration_closed: "form",
  invalid_member_count: "members",
  missing_captain: "members",
  invalid_email_domain: "members",
  duplicate_team_name: "teamName",
  duplicate_register_number: "members",
  duplicate_email: "members",
  duplicate_member_field: "members",
};

/** Parses a `[code] message` exception string raised by a Postgres RPC. */
export function parseRpcErrorCode(message: string): { code: string; message: string } | null {
  const match = /^\[([a-z_]+)]\s*(.*)$/.exec(message);
  if (!match) return null;
  return { code: match[1], message: match[2] };
}

/**
 * Sibling to parseRpcErrorCode() — some auction RPCs (record_sale) need to
 * return every violated rule, not just one message. Postgres exceptions
 * carry a MESSAGE and a DETAIL separately; PostgrestError exposes both as
 * `.message`/`.details`. This parses the structured JSON array a function
 * attached via `using detail = ...`.
 */
export function parseRpcErrorDetail<T = unknown>(detail: string | null | undefined): T | null {
  if (!detail) return null;
  try {
    return JSON.parse(detail) as T;
  } catch {
    return null;
  }
}
