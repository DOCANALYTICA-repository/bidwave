"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function AdminNavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={cn(
        "block rounded-lg border border-transparent px-3 py-1.5 font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "border-border bg-surface-3 text-foreground shadow-sm"
          : "text-ink-2 hover:border-border hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}
