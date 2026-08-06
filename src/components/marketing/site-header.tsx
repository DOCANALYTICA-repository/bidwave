"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { BrandMark } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/rounds", label: "Rounds" },
  { href: "/schedule", label: "Schedule" },
  { href: "/prizes", label: "Prizes" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/live", label: "Live" },
  { href: "/faqs", label: "FAQs" },
];

/**
 * Persistent chrome for every route under src/app/(public) — the route
 * group means Next.js never remounts this between page transitions, which
 * is what gives the SPA feel (no header flash on navigation) without any
 * custom client router.
 */
export function SiteHeader({
  isAuthenticated,
  isAdmin,
}: {
  isAuthenticated: boolean;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dashboardHref = isAdmin ? "/admin" : "/app";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark name="bidwave" height={28} priority />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 font-heading text-xs font-semibold uppercase tracking-wide transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "text-gold" : "text-ink-2 hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {isAuthenticated ? (
            <Button render={<Link href={dashboardHref} />} size="sm">
              Dashboard
            </Button>
          ) : (
            <>
              <Button variant="ghost" render={<Link href="/login" />} size="sm">
                Login
              </Button>
              <Button render={<Link href="/register" />} size="sm">
                Register
              </Button>
            </>
          )}
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={<Button variant="ghost" size="icon" className="lg:hidden" />}
          >
            <Menu />
            <span className="sr-only">Open menu</span>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 px-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-2 font-heading text-sm font-semibold uppercase tracking-wide text-ink-2 outline-none hover:bg-surface-3 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-2 p-4">
              {isAuthenticated ? (
                <Button render={<Link href={dashboardHref} onClick={() => setOpen(false)} />}>
                  Dashboard
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    render={<Link href="/login" onClick={() => setOpen(false)} />}
                  >
                    Login
                  </Button>
                  <Button render={<Link href="/register" onClick={() => setOpen(false)} />}>
                    Register
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
