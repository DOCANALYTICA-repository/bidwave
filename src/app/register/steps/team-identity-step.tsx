"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHRIST_CAMPUSES } from "@/lib/validation/registration";
import type { WizardValues } from "@/app/register/wizard-types";

export function TeamIdentityStep({
  values,
  errors,
  onChange,
}: {
  values: WizardValues;
  errors: Record<string, string[]>;
  onChange: (patch: Partial<WizardValues>) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="teamName">Team name</Label>
        <Input
          id="teamName"
          value={values.teamName}
          onChange={(e) => onChange({ teamName: e.target.value })}
          placeholder="Royal Commerce Challengers"
          aria-invalid={!!errors.teamName}
        />
        {errors.teamName?.map((msg) => (
          <p key={msg} className="text-xs text-unsold">
            {msg}
          </p>
        ))}
        <p className="text-xs text-ink-3">
          This is your team&apos;s public identity for the whole event — choose carefully.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="campus">Campus</Label>
        <Select
          value={values.campus}
          onValueChange={(v) => onChange({ campus: v as WizardValues["campus"] })}
        >
          <SelectTrigger id="campus" className="w-full" aria-invalid={!!errors.campus}>
            <SelectValue placeholder="Select your campus" />
          </SelectTrigger>
          <SelectContent>
            {CHRIST_CAMPUSES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.campus?.map((msg) => (
          <p key={msg} className="text-xs text-unsold">
            {msg}
          </p>
        ))}
      </div>
    </div>
  );
}
