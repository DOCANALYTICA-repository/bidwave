"use client";

/**
 * Catastrophic fallback — only fires if the root layout itself throws
 * (vanishingly rare). Next.js requires this file to render its own
 * <html>/<body> since it replaces the whole tree, so it can't reuse
 * RootLayout's fonts/providers. Kept deliberately minimal.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-sm text-sm text-white/70">
          An unexpected error occurred. You can try again, or head back to the homepage.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="cursor-pointer rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15"
          >
            Try again
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- this fallback only
              renders when the root layout itself threw, so the Next.js router context it
              replaced may be broken too; a plain <a> has no such dependency. */}
          <a
            href="/"
            className="cursor-pointer rounded-lg border border-white/20 px-4 py-2 text-sm font-medium hover:bg-white/10"
          >
            Back to home
          </a>
        </div>
      </body>
    </html>
  );
}
