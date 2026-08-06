import { cn } from "@/lib/utils";

/**
 * The finalized print brochure, committed to public/ as a static asset
 * (not admin-editable — swapping it needs a redeploy, an accepted
 * tradeoff for a one-time print artifact). See public/bidwave-brochure.pdf.
 */
export function BrochureDownloadLink({ className }: { className?: string }) {
  return (
    <a
      href="/bidwave-brochure.pdf"
      download="BIDWAVE-2026-Brochure.pdf"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "font-heading text-xs font-semibold uppercase tracking-widest text-gold underline underline-offset-4",
        className,
      )}
    >
      Download brochure
    </a>
  );
}
