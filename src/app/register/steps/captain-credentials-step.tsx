"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import type { WizardValues } from "@/app/register/wizard-types";

export function CaptainCredentialsStep({
  values,
  errors,
  onChange,
}: {
  values: WizardValues;
  errors: Record<string, string[]>;
  onChange: (patch: Partial<WizardValues>) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const captain = values.members.find((m) => m.isCaptain);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Shared team login email</Label>
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm">
          {captain?.christEmail || "— go back and mark a member as captain —"}
        </div>
        <p className="text-xs text-ink-3">
          This is the captain&apos;s CHRIST email from the previous step. The whole team signs in with
          this email and the password you set below.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="captainPassword">Password</Label>
        <div className="relative">
          <Input
            id="captainPassword"
            type={showPassword ? "text" : "password"}
            value={values.captainPassword}
            onChange={(e) => onChange({ captainPassword: e.target.value })}
            aria-invalid={!!errors.captainPassword}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
        {errors.captainPassword?.map((msg) => (
          <p key={msg} className="text-xs text-unsold">
            {msg}
          </p>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="captainPasswordConfirm">Confirm password</Label>
        <Input
          id="captainPasswordConfirm"
          type={showPassword ? "text" : "password"}
          value={values.captainPasswordConfirm}
          onChange={(e) => onChange({ captainPasswordConfirm: e.target.value })}
          aria-invalid={!!errors.captainPasswordConfirm}
        />
        {errors.captainPasswordConfirm?.map((msg) => (
          <p key={msg} className="text-xs text-unsold">
            {msg}
          </p>
        ))}
      </div>

      <p className="text-xs text-ink-3">
        No email verification is required — the account activates the moment you complete
        registration.
      </p>
    </div>
  );
}
