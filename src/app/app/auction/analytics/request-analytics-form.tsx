"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/bidwave";
import { requestAnalytics, type RequestAnalyticsState } from "@/app/app/auction/analytics/actions";

const initialState: RequestAnalyticsState = { status: "idle" };

export function RequestAnalyticsForm({ price, balance }: { price: number; balance: number }) {
  const [state, formAction, isPending] = useActionState(requestAnalytics, initialState);
  const insufficientFunds = balance < price;

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.status === "success") toast.success("Analytics requested.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }

  return (
    <form action={formAction} className="space-y-3">
      {insufficientFunds && (
        <p className="text-sm text-unsold">
          Your purse balance (<Money value={balance} />) is below the analytics price.
        </p>
      )}
      {state.status === "error" && <p className="text-sm text-unsold">{state.formError}</p>}
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
