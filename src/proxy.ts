import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { ROUND_COPY } from "@/lib/rounds-catalog";

/**
 * Next.js 16 renamed `middleware.ts`/`middleware()` to `proxy.ts`/`proxy()`
 * (same network-boundary mechanism, new name). This refreshes the Supabase
 * session cookie on every request AND is the first of two gates on
 * /admin/** — every admin Server Action also calls requireAdmin() itself
 * (src/lib/require-role.ts), since a route-based gate alone doesn't
 * protect an action if it's ever imported from an ungated page later.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Touches the session so an expired access token gets refreshed via the
  // cookie's refresh token before any Server Component reads it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const role = user?.app_metadata?.role as "admin" | "team" | undefined;

  // /rounds/[slug] calling notFound() still returns HTTP 200 — Next 16
  // streams (public)/loading.tsx's Suspense fallback before the page
  // component (and its notFound() check) ever runs, and the status code
  // can't change once streaming has started (see loading.tsx's own "Status
  // Codes" doc: "place notFound() before those boundaries, ... or run this
  // check in proxy"). ROUND_COPY's keys are a fixed compile-time set, so
  // this needs no DB call — genuinely unknown slugs get a real 404 here;
  // slugs that exist but aren't released yet still reach the page (200 +
  // its EmptyState), which is correct — that isn't a 404 case.
  const roundsMatch = pathname.match(/^\/rounds\/([^/]+)\/?$/);
  if (roundsMatch && !(roundsMatch[1] in ROUND_COPY)) {
    // A minimal inline page, not the full styled not-found.tsx — proxy
    // runs before the React tree exists at all, so it can't render that
    // component. Status correctness (a real 404, not 200) is what a
    // crawler/monitoring check needs; the rare human hitting a typo'd
    // round slug still gets a link home.
    return new NextResponse(
      `<!doctype html><html><head><title>Not found · Bidwave</title></head>` +
        `<body style="background:#0a0a0a;color:#e5e5e5;font-family:sans-serif;` +
        `display:flex;min-height:100vh;flex-direction:column;align-items:center;` +
        `justify-content:center;gap:1rem;text-align:center">` +
        `<h1>Page not found</h1><p>The page you're looking for doesn't exist or has moved.</p>` +
        `<a href="/" style="color:#e6c15c">Back to home</a></body></html>`,
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  if (pathname.startsWith("/admin")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (role !== "admin") {
      return NextResponse.redirect(new URL("/app", request.url));
    }
  }

  if (pathname.startsWith("/app")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith("/login") && user) {
    return NextResponse.redirect(new URL(role === "admin" ? "/admin" : "/app", request.url));
  }

  // Mirrors the /login guard above. Registration deliberately never signs the
  // browser in (see the C1 comment in src/app/register/actions.ts), so
  // /register/success is reachable without a session and must stay excluded —
  // everything else under /register is a fresh wizard that an already
  // -authenticated (i.e. already-registered) team should never land back on.
  if (
    pathname.startsWith("/register") &&
    !pathname.startsWith("/register/success") &&
    user
  ) {
    return NextResponse.redirect(new URL(role === "admin" ? "/admin" : "/app", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and image optimization
     * requests, which never need a session.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
