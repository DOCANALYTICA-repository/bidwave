import Link from "next/link";
import { BrandMark } from "@/components/bidwave";
import { Button } from "@/components/ui/button";

/**
 * Only src/app/not-found.tsx existed, so a 404 inside (public) — e.g.
 * notFound() for an unknown /rounds/[slug] — rendered outside this route
 * group's layout entirely, dropping the marketing SiteHeader/SiteFooter.
 * Next requires a not-found.tsx colocated in the segment to be wrapped by
 * that segment's own layout.
 */
export default function PublicNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <BrandMark name="bidwave" height={40} />
      <h1 className="font-display text-2xl">Page not found</h1>
      <p className="text-sm text-ink-2">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <Button variant="outline" render={<Link href="/" />}>
        Back to home
      </Button>
    </div>
  );
}
