import { BrandMark, PoweredByCredit, PageTransition } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-actions";
import { QueryClientProvider } from "@/lib/query-client-provider";
import { AdminNavLink } from "@/app/admin/admin-nav-link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider>
      <div className="flex min-h-full">
        <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-border p-4">
          <div className="space-y-6">
            <BrandMark name="bidwave" height={28} />
            <nav className="space-y-1 text-sm">
              {[
                ["/admin/teams", "Teams"],
                ["/admin/rounds", "Rounds"],
                ["/admin/stages", "Stages"],
                ["/admin/leaderboard", "Leaderboard"],
                ["/admin/simulation", "Simulation"],
                ["/admin/auction/players", "Auction"],
                ["/admin/final-results", "Final results"],
                ["/admin/announcements", "Announcements"],
                ["/admin/activity", "Activity"],
                ["/admin/settings", "Settings"],
                ["/admin/exports", "Exports"],
                ["/admin/preview", "Preview"],
              ].map(([href, label]) => (
                <AdminNavLink key={href} href={href} label={label} />
              ))}
            </nav>
          </div>
          <div className="space-y-3">
            <form action={signOut}>
              <Button type="submit" variant="tile" size="sm" className="w-full justify-start">
                Sign out
              </Button>
            </form>
            <div className="border-t border-border pt-3">
              <PoweredByCredit size="lg" />
            </div>
          </div>
        </aside>
        <main className="flex-1">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </QueryClientProvider>
  );
}
