import { z } from "zod";

/**
 * AUC-01/04/07: mandatory identity fields per row, open-vocabulary
 * role/pool (DEP-05's real field list is still pending from the client).
 * Any header not matched by IMPORT_COLUMN_ALIASES becomes a `stats` key
 * automatically — this is how AUC-07's "extensible beyond mandatory
 * fields" is satisfied without a separate manual mapping step.
 */
export const playerImportRowSchema = z.object({
  externalRef: z.string().trim().max(64).optional(),
  fullName: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(40),
  basePrice: z.coerce.number().nonnegative(),
  pool: z.string().trim().min(1).max(60),
  nationality: z.string().trim().min(1).max(60),
  iplTeam: z.string().trim().max(60).optional(),
  stats: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export type PlayerImportRow = z.infer<typeof playerImportRowSchema>;

/** Lower-cased, whitespace-trimmed header text -> known field. */
export const IMPORT_COLUMN_ALIASES: Record<string, keyof PlayerImportRow> = {
  "external ref": "externalRef",
  "external_ref": "externalRef",
  id: "externalRef",
  "player name": "fullName",
  name: "fullName",
  "full name": "fullName",
  role: "role",
  category: "role",
  "base price": "basePrice",
  baseprice: "basePrice",
  price: "basePrice",
  pool: "pool",
  nationality: "nationality",
  country: "nationality",
  "ipl team": "iplTeam",
  "current ipl team": "iplTeam",
  team: "iplTeam",
};

export type ImportRowError = {
  row_number: number;
  field: string;
  message: string;
  raw_value: string;
};

/**
 * One raw spreadsheet row (already header-aliased into camelCase keys,
 * unmapped headers left as-is to become `stats`) -> a validated row or a
 * list of field errors. Mirrors validation/registration.ts's shape.
 */
export function parseImportRow(
  rowNumber: number,
  raw: Record<string, unknown>,
): { row: PlayerImportRow } | { errors: ImportRowError[] } {
  const { fullName, role, basePrice, pool, nationality, externalRef, iplTeam, ...rest } = raw as Record<
    string,
    unknown
  >;

  const stats: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      stats[key] = value;
    } else {
      stats[key] = String(value);
    }
  }

  const result = playerImportRowSchema.safeParse({
    externalRef,
    fullName,
    role,
    basePrice,
    pool,
    nationality,
    iplTeam,
    stats: Object.keys(stats).length > 0 ? stats : undefined,
  });

  if (!result.success) {
    return {
      errors: result.error.issues.map((issue) => ({
        row_number: rowNumber,
        field: issue.path.join(".") || "row",
        message: issue.message,
        raw_value: String(raw[issue.path[0] as string] ?? ""),
      })),
    };
  }

  return { row: result.data };
}
