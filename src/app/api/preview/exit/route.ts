import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { PREVIEW_COOKIE } from "@/lib/preview-mode";

/**
 * Leaves preview mode. A GET route (not a Server Action) so the banner's exit
 * link still works from inside an error.tsx boundary, where a failed action
 * is exactly what might have put the page there.
 *
 * Needs no auth check: clearing your own cookie is not a privileged act, and
 * the worst an unauthenticated caller can do is turn preview off.
 */
export async function GET(request: NextRequest) {
  (await cookies()).delete(PREVIEW_COOKIE);
  return NextResponse.redirect(new URL("/", request.url));
}
