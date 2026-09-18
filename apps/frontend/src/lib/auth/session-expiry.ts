/**
 * Whether this browser's session has ended, and sending it to sign in once.
 *
 * ── WHY A LATCH AND NOT A REDIRECT AT EVERY CALL SITE ───────────────────────
 * A session ends while a page is open, and that page is usually asking the
 * backend several things at once: the Dashboard alone loads counts, recent
 * Trips, today's agenda, driver statistics and maintenance warnings. When the
 * session goes, every one of those fails within the same second.
 *
 * Without somewhere to record "this has already been dealt with", each failure
 * would start its own navigation to the login page, and each retry and each
 * poll after it would start another. What the operator saw was the result:
 * error panels appearing and disappearing while requests kept going out, rather
 * than one clean move to the login page.
 *
 * So the fact is recorded HERE, once. The first failure redirects; the rest ask
 * this module, find the answer is already known, and do nothing. The API client
 * also asks before sending anything at all, which is what stops the requests
 * instead of merely hiding their errors.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── IT RESETS BY ITSELF ─────────────────────────────────────────────────────
 * The redirect is a full navigation, so a browser that comes back signed in
 * loads a fresh copy of this module with the flag unset. There is nothing to
 * clear and no way for a stale "ended" to survive into a new session.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This is NOT a logout: nothing here calls `/auth/logout` and the Auth0 session
 * is not ended. A browser whose session has already gone is being asked to
 * start a new one.
 */

import { redirectToLogin } from "./login-redirect";

let ended = false;

/** Whether authentication is known to be gone, so nothing should be sent. */
export function hasSessionEnded(): boolean {
  return ended;
}

/**
 * Records that the session is gone and sends the browser to sign in.
 *
 * Idempotent on purpose: ten failures produce one navigation. Called only when
 * re-authentication is genuinely required — see `access-token.ts` for the
 * endpoint's own 401, and `client.ts` for a backend 401 that survived a token
 * renewal.
 */
export function endSession(): void {
  if (ended) {
    return;
  }

  ended = true;

  redirectToLogin();
}
