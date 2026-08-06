import type { CHRIST_CAMPUSES, MemberInput } from "@/lib/validation/registration";
import { emptyMember } from "@/components/registration/member-roster-editor";

export const STEP_LABELS = [
  "Team identity",
  "Members",
  "Captain credentials",
  "Payment proof",
  "Review",
] as const;

export type WizardValues = {
  teamName: string;
  campus: (typeof CHRIST_CAMPUSES)[number] | "";
  members: MemberInput[];
  captainPassword: string;
  captainPasswordConfirm: string;
  invoiceFile: File | null;
};

export const initialWizardValues: WizardValues = {
  teamName: "",
  campus: "",
  members: [emptyMember(), emptyMember(), emptyMember()],
  captainPassword: "",
  captainPasswordConfirm: "",
  invoiceFile: null,
};
