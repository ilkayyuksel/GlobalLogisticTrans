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
 * Goes to the login page, if going there would help.
 *
 * Not on the server, where there is no browser to send. Not from the login page
 * itself or from the SDK's own `/auth/*` routes, which would be a redirect loop
 * around a flow that is already running.
 *
 * ── WHERE THE OPERATOR COMES BACK TO ────────────────────────────────────────
 * The page they were on travels as `returnTo`, exactly as the middleware sends
 * it when it turns an unauthenticated request away. The login panel reads that
 * parameter and hands it to `/auth/login`, so the existing Auth0 round trip
 * brings them back to the Trip or the week they were looking at instead of
 * dropping them on the Dashboard.
 *
 * Only a path is ever passed on, and `loginHref` checks that again before it
 * reaches Auth0 — a session ending is not a reason to trust the address bar.
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
  // The login page and the SDK's own /auth/* routes are a flow already running;
  // sending them to the login page would be a loop around it.
  if (pathname.startsWith(LOGIN_PAGE)) {
    return null;
  }

  return `${LOGIN_PAGE}?returnTo=${encodeURIComponent(`${pathname}${search}`)}`;
}
