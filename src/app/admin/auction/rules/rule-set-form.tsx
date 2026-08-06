"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  adminSaveAuctionRuleSet,
  adminGrantStartingPurses,
  adminApplyPendingSimulationRewards,
  type RuleSetActionState,
} from "@/app/admin/auction/rules/actions";
import type { Database } from "@/lib/supabase/types";

type RuleSet = Database["public"]["Tables"]["auction_rule_sets"]["Row"];

// "use server" files can only export async functions — the initial-state
// literal has to live here on the client side.
const ruleSetActionInitialState: RuleSetActionState = { status: "idle" };

export function RuleSetForm({
  ruleSet,
  eventEditionId,
  roundId,
}: {
  ruleSet: RuleSet | null;
  eventEditionId: string;
  roundId: string | null;
}) {
  const [state, formAction, isPending] = useActionState(adminSaveAuctionRuleSet, ruleSetActionInitialState);
  const [isGranting, setIsGranting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  return (
    <div className="space-y-8">
      <form action={formAction} className="space-y-4 rounded-xl border border-border bg-card p-6">
        <input type="hidden" name="ruleSetId" value={ruleSet?.id ?? ""} />
        <input type="hidden" name="expectedUpdatedAt" value={ruleSet?.updated_at ?? ""} />
        <input type="hidden" name="eventEditionId" value={eventEditionId} />
        <input type="hidden" name="roundId" value={roundId ?? ""} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rule-starting-purse">Starting purse</Label>
            <Input
              id="rule-starting-purse"
              name="startingPurse"
              type="number"
              min={0}
              defaultValue={ruleSet?.starting_purse ?? 100000000}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-analytics-price">Analytics price</Label>
            <Input
              id="rule-analytics-price"
              name="analyticsPrice"
              type="number"
              min={0}
              defaultValue={ruleSet?.analytics_price ?? 500}
              required
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="rule-min-squad">Min squad size</Label>
            <Input
              id="rule-min-squad"
              name="minSquadSize"
              type="number"
              min={0}
              defaultValue={ruleSet?.min_squad_size ?? 11}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-max-squad">Max squad size</Label>
            <Input
              id="rule-max-squad"
              name="maxSquadSize"
              type="number"
              min={0}
              defaultValue={ruleSet?.max_squad_size ?? 18}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-max-overseas">Max overseas</Label>
            <Input
              id="rule-max-overseas"
              name="maxOverseas"
              type="number"
              min={0}
              defaultValue={ruleSet?.max_overseas ?? 4}
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-role-limits">
            Role limits (JSON — e.g. {`{"batter":{"max":6}}`})
          </Label>
          <Textarea
            id="rule-role-limits"
            name="roleLimits"
            rows={3}
            defaultValue={JSON.stringify(ruleSet?.role_limits ?? {}, null, 2)}
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-pool-limits">
            Pool limits (JSON — e.g. {`{"A":{"max":8}}`})
          </Label>
          <Textarea
            id="rule-pool-limits"
            name="poolLimits"
            rows={3}
            defaultValue={JSON.stringify(ruleSet?.pool_limits ?? {}, null, 2)}
            className="font-mono text-xs"
          />
        </div>

        {state.status === "error" && state.formError && (
          <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
            {state.formError}
          </p>
        )}
        {state.status === "success" && (
          <p className="rounded-lg border border-sold/30 bg-sold/10 px-3 py-2 text-sm text-sold">Saved.</p>
        )}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Saving…" : ruleSet ? "Save rule set" : "Create rule set"}
        </Button>
      </form>

      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-gold">
          Purse operations
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={isGranting || !ruleSet}
            onClick={async () => {
              setIsGranting(true);
              try {
                const granted = await adminGrantStartingPurses(eventEditionId);
                toast.success(`Granted starting purse to ${granted} team(s).`);
              } finally {
                setIsGranting(false);
              }
            }}
          >
            {isGranting ? "Granting…" : "Grant starting purses"}
          </Button>
          <Button
            variant="outline"
            disabled={isApplying}
            onClick={async () => {
              setIsApplying(true);
              try {
                const applied = await adminApplyPendingSimulationRewards();
                toast.success(`Applied ${applied} pending simulation reward(s).`);
              } finally {
                setIsApplying(false);
              }
            }}
          >
            {isApplying ? "Applying…" : "Apply pending simulation rewards"}
          </Button>
        </div>
      </div>
    </div>
  );
}
