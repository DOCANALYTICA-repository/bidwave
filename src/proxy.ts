import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

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
