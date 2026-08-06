import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * No back-navigation affordance existed anywhere in the product — every
 * deep page relied solely on persistent nav chrome (sidebar/tab bar).
 * Deliberately excluded from src/app/app/quiz/[roundId]/** — that lockdown
 * (QZ-13) is intentional anti-cheat, not an oversight.
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-gold",
        className,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
