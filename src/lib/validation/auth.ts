import { z } from "zod";

/**
 * Single login form for both teams and admin (§7.2: email-and-password
 * only, one mechanism — role is resolved from the account's own
 * app_metadata after sign-in, not by a separate admin login page).
 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export type LoginInput = z.infer<typeof loginSchema>;
