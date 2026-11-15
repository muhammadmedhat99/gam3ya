import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

const PUBLIC_PATHS = new Set(["/login", "/register", "/offline"]);

/**
 * Optimistic check only: no cookie → send to /login.
 * The real session check (DB) happens in src/server/auth/dal.ts on every page and action.
 * We don't redirect away from /login here, because a stale cookie would cause a loop.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Static assets, the PWA files (manifest, service worker, icons) and Next internals skip the proxy.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|icon|apple-icon|.*\\.(?:png|svg|jpg|ico|webp)$).*)",
  ],
};
