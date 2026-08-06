import Link from "next/link";
import { BrandMark, PoweredByCredit } from "@/components/bidwave";
import { getSettings } from "@/lib/supabase/settings";
import { BrochureDownloadLink } from "@/components/marketing/brochure-download-link";

export async function SiteFooter() {
  const settings = await getSettings(["contacts", "instagram_url"]);
  const contacts = settings.contacts ?? [];

  return (
    <footer className="border-t border-border bg-surface-1">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-12 sm:px-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-6">
            <BrandMark name="bidwave" height={32} />
            <BrandMark name="christ-university" height={28} />
            <BrandMark name="doc-commerce" height={28} />
          </div>
          <BrochureDownloadLink />
        </div>

        {contacts.length > 0 && (
          <div className="grid gap-4 border-t border-border pt-6 sm:grid-cols-3">
            {contacts.map((c) => (
              <div key={c.name} className="text-sm">
                <p className="font-heading font-semibold text-foreground">{c.name}</p>
                <p className="text-ink-2">{c.role}</p>
                <a href={`tel:+91${c.phone}`} className="text-ink-2 hover:text-gold">
                  {c.phone}
                </a>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-6 text-xs text-ink-3 sm:flex-row">
          <p>© 2026 Department of Commerce, CHRIST University. Bidwave.</p>
          <div className="flex items-center gap-4">
            {settings.instagram_url && (
              <a
                href={settings.instagram_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gold"
              >
                Instagram
              </a>
            )}
            <Link href="/login" className="hover:text-gold">
              Admin
            </Link>
            <PoweredByCredit size="md" />
          </div>
        </div>
      </div>
    </footer>
  );
}
