"use client";

import { MemberRosterEditor } from "@/components/registration/member-roster-editor";
import type { WizardValues } from "@/app/register/wizard-types";

export function MembersStep({
  values,
  errors,
  onChange,
}: {
  values: WizardValues;
  errors: Record<string, string[]>;
  onChange: (patch: Partial<WizardValues>) => void;
}) {
  return (
    <MemberRosterEditor
      members={values.members}
      errors={errors}
      onChange={(members) => onChange({ members })}
    />
  );
}
