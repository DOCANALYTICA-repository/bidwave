"use client";

import { FileDrop } from "@/components/bidwave";
import { INVOICE_MAX_BYTES } from "@/lib/validation/registration";
import type { WizardValues } from "@/app/register/wizard-types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CompassIcon } from "lucide-react";

const PAYMENT_GUIDE_STEPS = [
  <>
    Visit{" "}
    <a
      href="https://christuniversity.in/online-payment-portal"
      target="_blank"
      rel="noopener noreferrer"
    >
      christuniversity.in/online-payment-portal
    </a>
  </>,
  "Select Office: Other",
  "Select Category: Other",
  "Scroll down",
  "Select Bangalore Central Campus (you will be redirected to a new page)",
  "Select Fee Name: Events",
  "Select Category: Fest",
  "Select Category (second time): Bidwave-CHRISTITE",
  "Continue",
  'Fill in the payment form (you may put a "-" for PAN number if you don’t have one)',
  "Once paid, attach the receipt in the field below",
];

function PaymentGuideDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-1 p-3 text-left text-xs text-ink-2 transition-colors hover:bg-surface-2"
          />
        }
      >
        <CompassIcon className="size-4 shrink-0 text-ink-3" />
        <span className="font-heading font-semibold">Guide for Payment</span>
        <span className="ml-auto text-ink-3">View steps &rarr;</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Guide for Payment</DialogTitle>
          <DialogDescription>
            Follow these steps on the CHRIST University payment portal
            before uploading your proof.
          </DialogDescription>
        </DialogHeader>
        <ol className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {PAYMENT_GUIDE_STEPS.map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold/10 text-xs font-semibold text-gold">
                {index + 1}
              </span>
              <span className="pt-0.5 text-sm text-ink-2">{step}</span>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

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
      <PaymentGuideDialog />
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
