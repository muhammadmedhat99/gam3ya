import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

const PUBLIC_PATHS = new Set(["/login", "/register"]);

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
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
};
