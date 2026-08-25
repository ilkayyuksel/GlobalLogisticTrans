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
 */
export function redirectToLogin(): void {
  if (typeof window === "undefined") {
    return;
  }

  if (window.location.pathname.startsWith(LOGIN_PAGE)) {
    return;
  }

  window.location.assign(LOGIN_PAGE);
}
