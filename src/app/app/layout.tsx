import { BrandMark, PoweredByCredit, PageTransition } from "@/components/bidwave";
import { SignOutButton } from "@/app/app/sign-out-button";

/**
 * Team shell — minimal for now. The real classroom-style dashboard
 * (DASH-01..08, §8.1 status language) is Phase 3 scope; this just gives
 * /login a real, guarded destination for a team session.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <BrandMark name="bidwave" height={28} />
        <SignOutButton />
      </header>
      <main className="flex flex-1 flex-col">
        <PageTransition>{children}</PageTransition>
      </main>
      <footer className="flex items-center justify-center border-t border-border px-6 py-4">
        <PoweredByCredit size="md" />
      </footer>
    </div>
  );
}
