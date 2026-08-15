import { z } from "zod";

/**
 * Shared validation for the round engine (Phase 3): round builder,
 * materials, rubric criteria, submissions, scores. Same idiom as
 * registration.ts — client-side validation here is UX only, migration
 * 003's RPCs are the real authority.
 */

export const ROUND_KINDS = [
  "quiz",
  "submission",
  "offline_info",
  "simulation",
  "auction",
  "conference",
] as const;

export const roundFormSchema = z.object({
  roundId: z.string().uuid().nullable(),
  expectedUpdatedAt: z.string().nullable(),
  kind: z.enum(ROUND_KINDS),
  sequence: z.coerce.number().int().min(1),
  slug: z
    .string()
    .trim()
    .min(1, "Required")
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
  title: z.string().trim().min(1, "Required").max(200),
  brief: z.string().trim().max(10000).optional().or(z.literal("")),
  instructions: z.string().trim().max(10000).optional().or(z.literal("")),
  opensAt: z.string().optional().or(z.literal("")),
  closesAt: z.string().optional().or(z.literal("")),
  requiresQualificationFromStage: z.string().uuid().optional().or(z.literal("")),
  rubricTotalMode: z.enum(["weighted_sum", "weighted_percent"]),
});

export type RoundFormInput = z.infer<typeof roundFormSchema>;

export const materialFormSchema = z.object({
  materialId: z.string().uuid().nullable(),
  roundId: z.string().uuid(),
  kind: z.enum(["file", "link", "text"]),
  title: z.string().trim().min(1, "Required").max(200),
  url: z.string().trim().url().optional().or(z.literal("")),
  body: z.string().trim().max(20000).optional().or(z.literal("")),
  publicRelease: z.boolean(),
  position: z.coerce.number().int().min(0),
});

export const rubricCriterionSchema = z.object({
  criterionId: z.string().uuid().nullable(),
  roundId: z.string().uuid(),
  label: z.string().trim().min(1, "Required").max(200),
  maxValue: z.coerce.number().positive(),
  weight: z.coerce.number().positive(),
  position: z.coerce.number().int().min(0),
});

export const scoreFormSchema = z.object({
  roundId: z.string().uuid(),
  teamId: z.string().uuid(),
  expectedUpdatedAt: z.string().nullable(),
  total: z.coerce.number().min(0),
  maxTotal: z.coerce.number().min(0).optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

/** RPC error codes -> the form field that should show the message. */
export const ROUND_ERROR_FIELD: Record<string, string> = {
  duplicate_round_slug: "slug",
  stale_edit: "form",
  invalid_kind: "kind",
  round_already_closed: "form",
  round_not_closed: "form",
  round_not_scored: "form",
  invalid_action: "form",
  submission_not_allowed: "form",
  no_files: "form",
  not_found: "form",
  invalid_material: "form",
  invalid_criterion: "form",
  invalid_decision: "form",
  // 20260814050000 — quiz re-attempt round.
  not_eligible: "form",
  resume_not_allowed: "form",
  eligibility_locked: "form",
  invalid_supersede: "form",
  invalid_policy: "form",
  invalid_strike_kind: "form",
};
