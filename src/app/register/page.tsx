import type { Metadata } from "next";
import { RegisterWizard } from "@/app/register/register-wizard";
import { getSettings } from "@/lib/supabase/settings";

export const metadata: Metadata = { title: "Register your team" };

export default async function RegisterPage() {
  // payment_instructions was defined in the settings schema but read
  // nowhere in the app (Phase 5) — the invoice step is the one place a
  // team actually needs it, right before they're asked to upload proof.
  const { payment_instructions: paymentInstructions } = await getSettings(["payment_instructions"]);
  return <RegisterWizard paymentInstructions={paymentInstructions ?? null} />;
}
