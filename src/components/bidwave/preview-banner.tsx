import { getPreviewSession } from "@/lib/preview-mode";
import { PreviewCountdown } from "@/components/bidwave/preview-countdown";

/**
 * Rendered from the root layout so it covers *every* page — the public site,
 * /login, /register and both consoles. Scoping it to /app + /admin + /live
 * would miss precisely the pages an admin isn't thinking about when they
 * forget to leave preview on.
 *
 * Fuchsia on purpose: it is the one loud colour that appears nowhere in the
 * Broadcast or Console palettes. A gold banner would read as ordinary chrome
 * and stop being visible within the hour — which is the entire failure mode
 * this exists to prevent.
 *
 * Renders nothing at all when preview is inactive, which is the default and
 * the permanent state once BIDWAVE_PREVIEW_SECRET is removed.
 */
export async function PreviewBanner() {
  const session = await getPreviewSession();
  if (!session) return null;

  return (
    <>
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-fuchsia-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg"
      >
        <span className="uppercase tracking-wide">Preview mode — not the live event</span>
        <span className="font-mono text-xs font-normal opacity-90">
          edition: {session.slug} <PreviewCountdown expiresAt={session.exp} />
        </span>
        <a
          href="/api/preview/exit"
          className="rounded bg-white/20 px-2 py-0.5 text-xs underline-offset-2 hover:bg-white/30 hover:underline"
        >
          Exit preview
        </a>
      </div>
      {/* Spacer so the fixed bar never covers page content. */}
      <div aria-hidden className="h-9 shrink-0" />
    </>
  );
}
