/**
 * Sending a browser back to sign in.
 *
 * ── A MODULE OF ITS OWN, AND NOT ONLY FOR TESTS ─────────────────────────────
 * Getting an access token and deciding where a browser goes are two jobs. The
 * token module's business is a token; navigation is this one's, and keeping the
 * two apart means the rule below — never from the login page, never on the
 * server — lives in one place rather than being restated wherever a session
 * turns out to be gone.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This is NOT a logout. Nothing here calls `/auth/logout` and the Auth0 session
 * is not ended: a browser whose session has already expired is being asked to
 * start a new one, which is a different thing and must stay so.
 *
 * A full navigation rather than the Next router, deliberately. The session is
 * gone, so every cached page and every piece of client state behind it belongs
 * to somebody who is no longer signed in — a soft route transition would keep
 * all of it in memory.
 */

/** Our own branded entry page, the same one the middleware redirects to. */
export const LOGIN_PAGE = "/auth";

/**
 * The SDK's own login route, which STARTS a new Auth0 authorization.
 *
 * ── WHY NOT THE BRANDED PAGE ────────────────────────────────────────────────
 * A browser whose token cannot be renewed usually still holds a valid SESSION
 * COOKIE: the Auth0 SDK answers 401 for a refresh it cannot perform — a revoked
 * or absent refresh token — and only clears the cookie when the session itself
 * has expired. The middleware, seeing that cookie, treats the visitor as signed
 * in and sends anyone standing on `/auth` onward to the Dashboard.
 *
 * Sending an expired browser to `/auth` therefore bounced it straight back to
 * the page it came from, which failed again, which redirected again — the
 * "unauthorized" errors appearing and disappearing that an operator saw on a
 * tab left open overnight.
 *
 * `/auth/login` cannot bounce: the middleware hands every `/auth/*` path to the
 * SDK, which redirects to Auth0 and comes back through the callback with a new
 * session. When the Auth0 session is still alive that round trip is invisible
 * and nobody types anything; when it is gone, Universal Login asks for the
 * password, which is what signing in again means.
 *
 * It is the same route the "Log in" button points at — see `loginHref`.
 */
export const LOGIN_ROUTE = "/auth/login";

/**
 * Starts the Auth0 login flow, if starting it would help.
 *
 * Not on the server, where there is no browser to send. Not from the login page
 * itself or from the SDK's own `/auth/*` routes, which would be a loop around a
 * flow that is already running.
 *
 * ── WHERE THE OPERATOR COMES BACK TO ────────────────────────────────────────
 * The page they were on travels as `returnTo`, the same parameter the branded
 * page hands to `/auth/login` when somebody presses the button, so the existing
 * Auth0 round trip brings them back to the Trip or the week they were looking
 * at instead of dropping them on the Dashboard.
 *
 * Only a path within this application is ever passed on: a full URL would let a
 * crafted link send somebody elsewhere the moment they signed in.
 */
export function redirectToLogin(): void {
  if (typeof window === "undefined") {
    return;
  }

  const destination = loginDestination(
    window.location.pathname,
    window.location.search,
  );

  if (destination === null) {
    return;
  }

  window.location.assign(destination);
}

/**
 * Where a browser on this page should be sent, or null for "stay".
 *
 * Separate from the navigation because the navigation is the one thing no test
 * can watch: jsdom's `window.location` can be neither replaced nor spied on. The
 * RULE — which pages are left alone, and what the login page is told about where
 * the operator was — is decided here, where it can be proven.
 */
export function loginDestination(
  pathname: string,
  search: string,
): string | null {
  // The branded page and the SDK's own /auth/* routes are a flow already
  // running; starting another one from inside it would be a loop.
  if (pathname.startsWith(LOGIN_PAGE)) {
    return null;
  }

  return loginHref(`${pathname}${search}`);
}

/**
 * The link that signs somebody in, carrying where they were.
 *
 * ONE definition, used by the button on the branded page and by a browser whose
 * session has run out, so both start the same flow in the same way. Only an
 * internal path survives the round trip: a full URL here would let a crafted
 * link send someone to another site the moment they signed in, wearing TRAXO's
 * login as the last thing they saw.
 */
export function loginHref(returnTo: string | null): string {
  const isSafeInternalPath =
    returnTo !== null && returnTo.startsWith("/") && !returnTo.startsWith("//");

  return isSafeInternalPath
    ? `${LOGIN_ROUTE}?returnTo=${encodeURIComponent(returnTo)}`
    : LOGIN_ROUTE;
}
