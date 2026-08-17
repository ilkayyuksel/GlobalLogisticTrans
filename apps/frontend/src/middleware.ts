import { NextResponse, type NextRequest } from "next/server";

import { auth0, isAuthConfigured } from "@/lib/auth/auth0";

/**
 * Nothing in TRAXO is reachable without signing in.
 *
 * ── WHY THE MIDDLEWARE AND NOT PER-PAGE CHECKS ──────────────────────────────
 * A page-level check protects the page whose author remembered to add it. This
 * runs before every request that is not explicitly excluded below, so a page
 * added next month is protected by existing.
 *
 * It is not the only protection. The NestJS API verifies the access token on
 * every call, and that is what actually guards the data: this layer decides
 * what a browser is shown, and an unauthenticated fetch would be refused by the
 * backend regardless.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The SDK's middleware must run first: it serves /auth/login, /auth/callback,
 * /auth/logout, /auth/profile and /auth/access-token, and it is what refreshes
 * the session cookie. Only after it has had the request does this decide
 * whether the visitor may continue.
 */

/** Our own branded entry page. Everything else under /auth is the SDK's. */
const LOGIN_PAGE = "/auth";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  /*
   * With no tenant configured the SDK cannot start a flow at all, and calling
   * it would fail with an internal error on every page. Letting the request
   * through keeps a checkout without Auth0 credentials usable for development,
   * and the entry page says clearly that authentication is not configured.
   *
   * This can only happen where the environment is incomplete. A deployment that
   * reached this branch has no working login, which is visible immediately.
   */
  if (!isAuthConfigured()) {
    return NextResponse.next();
  }

  const response = await auth0.middleware(request);
  const { pathname } = request.nextUrl;

  // The SDK owns these; it has already produced the answer.
  if (pathname.startsWith("/auth/")) {
    return response;
  }

  const session = await auth0.getSession(request);

  if (session) {
    // Signed in and standing on the login page: send them where they were
    // going. A login form for someone already signed in is a dead end.
    if (pathname === LOGIN_PAGE) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return response;
  }

  if (pathname === LOGIN_PAGE) {
    return response;
  }

  /*
   * Sent to the branded entry page rather than straight to Auth0, so the first
   * thing an operator sees is TRAXO. `returnTo` carries where they meant to go,
   * so a bookmarked deep link survives signing in.
   */
  const login = new URL(LOGIN_PAGE, request.url);
  login.searchParams.set("returnTo", pathname + request.nextUrl.search);

  return NextResponse.redirect(login);
}

export const config = {
  /*
   * Everything except Next's own assets and the favicon.
   *
   * Static files are excluded because they are not data and the redirect would
   * only make pages load slower. `_next/image` is included in that exclusion:
   * the logo has to render on the login page itself, which is the one page an
   * unauthenticated visitor is allowed to see.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
