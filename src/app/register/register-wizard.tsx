"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { registerTeam, type RegisterActionState } from "@/app/register/actions";
import { registrationDetailsSchema, invoiceFileSchema } from "@/lib/validation/registration";
import { initialWizardValues, STEP_LABELS, type WizardValues } from "@/app/register/wizard-types";
import { TeamIdentityStep } from "@/app/register/steps/team-identity-step";
import { MembersStep } from "@/app/register/steps/members-step";
import { CaptainCredentialsStep } from "@/app/register/steps/captain-credentials-step";
import { InvoiceStep } from "@/app/register/steps/invoice-step";
import { ReviewStep } from "@/app/register/steps/review-step";
import { Button } from "@/components/ui/button";
import { BrandMark, BackLink } from "@/components/bidwave";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";

// Which top-level field each step owns, used to decide (a) which errors to
// surface while the user is still on that step and (b) which step to jump
// back to when the server rejects a field this wizard already passed.
const STEP_FIELD_KEYS = [
  ["teamName", "campus"],
  ["members"],
  ["captainPassword", "captainPasswordConfirm"],
  ["invoiceFile"],
  [],
] as const;

type Issue = { path: PropertyKey[]; message: string };

function errorsForKeys(issues: Issue[], keys: readonly string[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const topKey = String(issue.path[0] ?? "");
    if (!keys.includes(topKey)) continue;
    const pathKey = issue.path.length ? issue.path.join(".") : topKey;
    errors[pathKey] = [...(errors[pathKey] ?? []), issue.message];
  }
  return errors;
}

function stepIndexForField(field: string): number {
  const topKey = field.split(".")[0];
  const idx = STEP_FIELD_KEYS.findIndex((keys) => (keys as readonly string[]).includes(topKey));
  return idx === -1 ? 0 : idx;
}

// A "use server" file can only export async functions — the initial state
// literal has to live on the client side instead of alongside the action.
const registerInitialState: RegisterActionState = { status: "idle" };

export function RegisterWizard() {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<WizardValues>(initialWizardValues);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [state, formAction, isPending] = useActionState(registerTeam, registerInitialState);

  // Server-side rejection (a duplicate the client couldn't have known
  // about, registration having just closed, etc.) — jump back to whichever
  // step owns the field and show it there (ERR-01: actionable, without
  // losing any other completed step's data).
  //
  // This has to be a real effect, not the usual "derive during render"
  // pattern: `state` here comes from useActionState, whose own transition
  // already updates a Router-owned component in the same commit — setting
  // local state synchronously in the render body collides with that
  // ("Cannot update a component (Router) while rendering a different
  // component"). An effect defers this to after commit, which is correct
  // for reacting to an action *result* landing (a discrete event), as
  // opposed to mirroring a plain prop.
  useEffect(() => {
    if (state.status === "error") {
      toast.error(state.formError ?? "Registration failed. Please check the highlighted fields.");
    }
    if (state.status === "error" && state.fieldErrors) {
      const firstField = Object.keys(state.fieldErrors)[0];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
      if (firstField) setStep(stepIndexForField(firstField));
      setErrors((prev) => ({ ...prev, ...state.fieldErrors }));
    }
  }, [state]);

  function patchValues(patch: Partial<WizardValues>) {
    setValues((v) => ({ ...v, ...patch }));
  }

  function validateStep(index: number): boolean {
    if (index === 3) {
      const result = invoiceFileSchema.safeParse(values.invoiceFile);
      if (!result.success) {
        setErrors((prev) => ({
          ...prev,
          invoiceFile: result.error.issues.map((i) => i.message),
        }));
        return false;
      }
      return true;
    }

    const result = registrationDetailsSchema.safeParse({
      teamName: values.teamName,
      campus: values.campus,
      members: values.members,
      captainPassword: values.captainPassword,
      captainPasswordConfirm: values.captainPasswordConfirm,
    });
    if (result.success) return true;

    const stepErrors = errorsForKeys(result.error.issues, STEP_FIELD_KEYS[index]);
    if (Object.keys(stepErrors).length === 0) return true; // errors belong to a later step
    setErrors((prev) => ({ ...prev, ...stepErrors }));
    return false;
  }

  function goNext() {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function handleSubmit() {
    const detailsResult = registrationDetailsSchema.safeParse({
      teamName: values.teamName,
      campus: values.campus,
      members: values.members,
      captainPassword: values.captainPassword,
      captainPasswordConfirm: values.captainPasswordConfirm,
    });
    const invoiceResult = invoiceFileSchema.safeParse(values.invoiceFile);

    if (!detailsResult.success || !invoiceResult.success) {
      const merged: Record<string, string[]> = {};
      if (!detailsResult.success) {
        for (const [key, val] of Object.entries(
          errorsForKeys(detailsResult.error.issues, [
            "teamName",
            "campus",
            "members",
            "captainPassword",
            "captainPasswordConfirm",
          ]),
        )) {
          merged[key] = val;
        }
      }
      if (!invoiceResult.success) {
        merged.invoiceFile = invoiceResult.error.issues.map((i) => i.message);
      }
      setErrors(merged);
      const firstField = Object.keys(merged)[0];
      if (firstField) setStep(stepIndexForField(firstField));
      return;
    }

    const fd = new FormData();
    fd.set("teamName", values.teamName);
    fd.set("campus", values.campus);
    fd.set("members", JSON.stringify(values.members));
    fd.set("captainPassword", values.captainPassword);
    fd.set("captainPasswordConfirm", values.captainPasswordConfirm);
    fd.set("invoiceFile", values.invoiceFile as File);
    formAction(fd);
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-16">
      <div className="flex items-center justify-between">
        <BackLink href="/" label="Back to home" />
        <Link href="/login" className="text-xs text-ink-2 underline-offset-4 hover:text-gold hover:underline">
          Already registered? Log in
        </Link>
      </div>
      <div className="flex flex-col items-center gap-4 text-center">
        <BrandMark name="bidwave" height={48} />
        <div>
          <h1 className="font-display text-2xl">Register your team</h1>
          <p className="text-sm text-ink-2">Bidwave 2026 · 17–19 August</p>
        </div>
      </div>

      <ol className="flex items-center justify-between gap-1">
        {STEP_LABELS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <div
              className={cn(
                "flex size-7 items-center justify-center rounded-full font-mono text-xs font-semibold",
                i === step
                  ? "bg-gold text-surface-0"
                  : i < step
                    ? "bg-sold/20 text-sold"
                    : "bg-surface-3 text-ink-3",
              )}
            >
              {i + 1}
            </div>
            <span
              className={cn(
                "hidden text-center text-[10px] uppercase tracking-wide sm:block",
                i === step ? "text-foreground" : "text-ink-3",
              )}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-border bg-surface-1 p-6">
        {step === 0 && (
          <TeamIdentityStep values={values} errors={errors} onChange={patchValues} />
        )}
        {step === 1 && <MembersStep values={values} errors={errors} onChange={patchValues} />}
        {step === 2 && (
          <CaptainCredentialsStep values={values} errors={errors} onChange={patchValues} />
        )}
        {step === 3 && <InvoiceStep values={values} errors={errors} onChange={patchValues} />}
        {step === 4 && (
          <ReviewStep
            values={values}
            formError={state.status === "error" ? state.formError : undefined}
            isPending={isPending}
            onSubmit={handleSubmit}
          />
        )}
      </div>

      {step < 4 && (
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={goBack} disabled={step === 0}>
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <Button type="button" onClick={goNext}>
            Next
          </Button>
        </div>
      )}
      {step === 4 && (
        <Button type="button" variant="ghost" onClick={goBack} disabled={isPending}>
          <ChevronLeft className="size-4" />
          Back
        </Button>
      )}
    </div>
  );
}
