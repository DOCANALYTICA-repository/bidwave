import { createClient } from "@/lib/supabase/server";
import { PageTransition } from "@/components/bidwave";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

/**
 * Route group — doesn't affect the URL. Wraps every public route so
 * SiteHeader/SiteFooter persist across navigation (Next.js doesn't remount
 * a shared layout between sibling routes under it), giving the SPA feel
 * the client asked for with ordinary next/link navigation.
 */
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <SiteHeader
        isAuthenticated={!!user}
        isAdmin={user?.app_metadata?.role === "admin"}
      />
      <main className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <SiteFooter />
    </>
  );
}
