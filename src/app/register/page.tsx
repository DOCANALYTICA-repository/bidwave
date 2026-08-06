import type { Metadata } from "next";
import { RegisterWizard } from "@/app/register/register-wizard";

export const metadata: Metadata = { title: "Register your team" };

export default function RegisterPage() {
  return <RegisterWizard />;
}
