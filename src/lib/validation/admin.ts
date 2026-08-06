import { z } from "zod";
import { CHRIST_CAMPUSES, membersArraySchema } from "@/lib/validation/registration";

/** ADM-02: admin edit of team + full member roster. ERR-07: optimistic
 * concurrency via expectedUpdatedAt, matched against admin_update_team()'s
 * p_expected_updated_at. */
export const adminUpdateTeamSchema = z.object({
  teamId: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
  teamName: z.string().trim().min(2, "At least 2 characters").max(80),
  campus: z.enum(CHRIST_CAMPUSES, { message: "Select a campus" }),
  members: membersArraySchema,
});

export type AdminUpdateTeamInput = z.infer<typeof adminUpdateTeamSchema>;

/** §7.2: password reset is a manual admin action, no self-service flow. */
export const adminResetPasswordSchema = z.object({
  teamId: z.string().uuid(),
  newPassword: z.string().min(8, "At least 8 characters").max(72),
});

export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
