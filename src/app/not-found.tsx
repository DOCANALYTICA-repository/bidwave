import Link from "next/link";
import { BrandMark } from "@/components/bidwave";
import { Button } from "@/components/ui/button";

/**
 * No not-found.tsx existed anywhere in the app — confirmed by direct
 * reproduction that `notFound()` calls (e.g. src/app/(public)/rounds/
 * [slug]/page.tsx for an unknown slug) render correct 404-looking content
 * but ship it with an HTTP 200 status, in both dev and a production build.
 * An explicit boundary is Next's documented mechanism for this exact case.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <BrandMark name="bidwave" height={40} />
      <h1 className="font-display text-2xl">Page not found</h1>
      <p className="text-sm text-ink-2">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <Button variant="outline" render={<Link href="/" />}>
        Back to home
      </Button>
    </div>
  );
}
