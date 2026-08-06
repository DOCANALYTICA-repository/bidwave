"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemberInput } from "@/lib/validation/registration";

export const emptyMember = (): MemberInput => ({
  fullName: "",
  className: "",
  registerNumber: "",
  phone: "",
  christEmail: "",
  isCaptain: false,
});

const FIELD_LABELS: { key: keyof MemberInput; label: string; placeholder: string }[] = [
  { key: "fullName", label: "Full name", placeholder: "Jane Doe" },
  { key: "className", label: "Class", placeholder: "BCom 3rd Year, Section A" },
  { key: "registerNumber", label: "Register number", placeholder: "23COM1234" },
  { key: "phone", label: "Phone number", placeholder: "9876543210" },
  { key: "christEmail", label: "CHRIST email", placeholder: "jane.doe@btech.christuniversity.in" },
];

/**
 * REG-02/03/04 roster editing — 3 compulsory + 1 optional member, exactly
 * one captain. Shared by the /register wizard's Members step and the
 * admin team-edit form (ADM-02), since both need the identical rules and
 * layout; only what happens to the resulting array on submit differs.
 */
export function MemberRosterEditor({
  members,
  errors,
  errorKeyPrefix = "members",
  onChange,
}: {
  members: MemberInput[];
  errors: Record<string, string[]>;
  /** Server errors are keyed "members.N.field"; pass a different prefix if a caller namespaces differently. */
  errorKeyPrefix?: string;
  onChange: (members: MemberInput[]) => void;
}) {
  function updateMember(index: number, patch: Partial<MemberInput>) {
    onChange(members.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function setCaptain(index: number) {
    onChange(members.map((m, i) => ({ ...m, isCaptain: i === index })));
  }

  function addFourthMember() {
    if (members.length < 4) onChange([...members, emptyMember()]);
  }

  function removeFourthMember() {
    if (members.length === 4) onChange(members.slice(0, 3));
  }

  const arrayErrors = errors[errorKeyPrefix];

  return (
    <div className="space-y-6">
      <div>
        <p className="font-heading text-sm font-semibold">Team members</p>
        <p className="text-xs text-ink-3">
          Three members are compulsory; a fourth is optional. Mark exactly one member as captain —
          their CHRIST email becomes the team&apos;s shared login.
        </p>
        {arrayErrors?.map((msg) => (
          <p key={msg} className="mt-1 text-xs text-unsold">
            {msg}
          </p>
        ))}
      </div>

      <div className="space-y-4">
        {members.map((member, index) => {
          const prefix = `${errorKeyPrefix}.${index}.`;
          return (
            <div
              key={index}
              className={cn(
                "space-y-4 rounded-xl border p-4",
                member.isCaptain ? "border-gold/50 bg-gold/5" : "border-border bg-card",
              )}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCaptain(index)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-heading text-xs font-semibold uppercase tracking-wide transition-colors",
                    member.isCaptain
                      ? "border-gold/40 bg-gold/15 text-gold"
                      : "border-border text-ink-2 hover:border-gold/30 hover:text-gold",
                  )}
                >
                  <Crown className="size-3.5" />
                  {member.isCaptain ? "Captain" : "Set as captain"}
                </button>
                {index === 3 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeFourthMember}
                    className="text-unsold hover:text-unsold"
                  >
                    <Trash2 className="size-3.5" />
                    Remove
                  </Button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {FIELD_LABELS.map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`${prefix}${key}`}>{label}</Label>
                    <Input
                      id={`${prefix}${key}`}
                      value={member[key] as string}
                      placeholder={placeholder}
                      onChange={(e) => updateMember(index, { [key]: e.target.value })}
                      aria-invalid={!!errors[`${prefix}${key}`]}
                    />
                    {errors[`${prefix}${key}`]?.map((msg) => (
                      <p key={msg} className="text-xs text-unsold">
                        {msg}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {members.length < 4 && (
        <Button type="button" variant="outline" size="sm" onClick={addFourthMember}>
          <Plus className="size-3.5" />
          Add a 4th member (optional)
        </Button>
      )}
    </div>
  );
}
