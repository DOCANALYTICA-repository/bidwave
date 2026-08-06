"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/bidwave";
import { Button } from "@/components/ui/button";

/**
 * Root-segment boundary — catches anything under app/ not covered by a more
 * specific nested error.tsx (admin/, app/, (public)/), notably the top-level
 * /login and /register routes, which sit outside the (public) route group.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <BrandMark name="bidwave" height={40} />
      <h1 className="font-display text-2xl">Something went wrong</h1>
      <p className="text-sm text-ink-2">
        An unexpected error occurred. You can try again, or head back to the homepage.
      </p>
      <div className="flex gap-3 pt-2">
        <Button variant="tile" onClick={() => reset()}>
          Try again
        </Button>
        <Button variant="outline" render={<Link href="/" />}>
          Back to home
        </Button>
      </div>
    </div>
  );
}
