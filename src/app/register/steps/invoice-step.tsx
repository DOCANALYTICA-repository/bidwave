"use client";

import { FileDrop } from "@/components/bidwave";
import { INVOICE_MAX_BYTES } from "@/lib/validation/registration";
import type { WizardValues } from "@/app/register/wizard-types";

export function InvoiceStep({
  values,
  errors,
  onChange,
  paymentInstructions,
}: {
  values: WizardValues;
  errors: Record<string, string[]>;
  onChange: (patch: Partial<WizardValues>) => void;
  paymentInstructions?: string | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-heading text-sm font-semibold">Payment proof</p>
        <p className="text-xs text-ink-3">
          Upload your invoice or payment screenshot as a PDF, JPG or PNG.
        </p>
        {paymentInstructions && (
          <p className="mt-2 whitespace-pre-line rounded-lg border border-border bg-surface-1 p-3 text-xs text-ink-2">
            {paymentInstructions}
          </p>
        )}
      </div>
      <FileDrop
        value={values.invoiceFile ? [values.invoiceFile] : []}
        onChange={(files) => onChange({ invoiceFile: files[0] ?? null })}
        accept=".pdf,.jpg,.jpeg,.png"
        multiple={false}
        maxSizeBytes={INVOICE_MAX_BYTES}
      />
      {errors.invoiceFile?.map((msg) => (
        <p key={msg} className="text-xs text-unsold">
          {msg}
        </p>
      ))}
    </div>
  );
}
