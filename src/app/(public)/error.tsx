"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PublicError({
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
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
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
