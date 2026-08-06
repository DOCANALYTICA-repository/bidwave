import Link from "next/link";

const AUCTION_NAV = [
  ["/admin/auction/players", "Players"],
  ["/admin/auction/rules", "Rules"],
  ["/admin/auction/console", "Console"],
  ["/admin/auction/analytics", "Analytics"],
  ["/admin/auction/analytics-requests", "Requests"],
] as const;

export default function AdminAuctionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="flex gap-1 border-b border-border px-6 py-3">
        {AUCTION_NAV.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-foreground"
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
