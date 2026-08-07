import Link from "next/link";
import { Button } from "@/components/ui/button";

/** See src/app/(public)/not-found.tsx for why this exists per route group. */
export default function AdminNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl">Page not found</h1>
      <p className="text-sm text-ink-2">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <Button variant="outline" render={<Link href="/admin" />}>
        Back to admin
      </Button>
    </div>
  );
}
