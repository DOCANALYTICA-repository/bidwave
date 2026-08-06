import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { SettingsValue } from "@/lib/supabase/settings";

export function RegistrationCtaSection({
  isOpen,
  fee,
  dashboardHref,
}: {
  isOpen: boolean;
  fee?: SettingsValue<"registration_fee">;
  /** Present when a session already exists — swaps the CTA to "Go to dashboard". */
  dashboardHref?: string;
}) {
  return (
    <section className="mx-auto max-w-2xl px-6 py-16 text-center">
      <div className="rounded-2xl border border-gold/30 bg-gold/5 p-8">
        <h2 className="font-display text-2xl">
          {dashboardHref
            ? "You're registered"
            : isOpen
              ? "Registration is open"
              : "Registration is closed"}
        </h2>
        {fee && (
          <p className="mt-2 text-sm text-ink-2">
            {fee.amount != null
              ? `Entry fee: ₹${fee.amount.toLocaleString("en-IN")}`
              : fee.note}
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          {dashboardHref ? (
            <Button size="lg" render={<Link href={dashboardHref} />}>
              Go to your dashboard
            </Button>
          ) : (
            <>
              {isOpen ? (
                <Button size="lg" render={<Link href="/register" />}>
                  Register your team
                </Button>
              ) : (
                <Button size="lg" disabled>
                  Registration closed
                </Button>
              )}
              <Button variant="outline" size="lg" render={<Link href="/login" />}>
                Team login
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
