"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/bidwave";
import { requestAnalytics, type RequestAnalyticsState } from "@/app/app/auction/analytics/actions";

/**
 * The success action here calls revalidatePath("/app/auction/analytics"),
 * which swaps this component's parent branch (pending/rejected/none ->
 * pending) in the same transition the action itself completes in. With
 * the previous `useActionState` + effect-on-state-change pattern, that
 * unmounted this form before its effect could run — the success toast
 * only fired sometimes, depending on exactly how the two updates
 * interleaved. Calling the server action directly from an event handler
 * and toasting on the awaited result, instead of reacting to derived
 * state, fires deterministically regardless of what the parent does
 * afterward — an imperative call in an event handler isn't torn down the
 * way a render effect is.
 */
export function RequestAnalyticsForm({ price, balance }: { price: number; balance: number }) {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const insufficientFunds = balance < price;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result: RequestAnalyticsState = await requestAnalytics({ status: "idle" }, formData);
      if (result.status === "success") {
        setFormError(null);
        toast.success("Analytics requested.");
      } else if (result.status === "error") {
        setFormError(result.formError ?? null);
        toast.error(result.formError ?? "Something went wrong.");
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-3">
      {insufficientFunds && (
        <p className="text-sm text-unsold">
          Your purse balance (<Money value={balance} />) is below the analytics price.
        </p>
      )}
      {formError && <p className="text-sm text-unsold">{formError}</p>}
      <Button type="submit" disabled={isPending || insufficientFunds}>
        {isPending ? (
          "Requesting…"
        ) : (
          <>
            Request analytics — <Money value={price} className="text-inherit" />
          </>
        )}
      </Button>
    </form>
  );
}
