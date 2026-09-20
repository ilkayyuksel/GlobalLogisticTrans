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
let reauthenticationFailed = false;
let attemptForgotten = false;

/**
 * That this tab has just been through Auth0, remembered across the round trip.
 *
 * `sessionStorage` because the redirect is a full navigation: a module variable
 * does not survive it, and the one thing that has to survive it is the fact
 * that signing in was already tried. Per tab, and gone when the tab closes.
 */
const ATTEMPT_KEY = "traxo.signing-in-again";

/**
 * A trip through Auth0 and back takes a few seconds. Coming back and being
 * refused again inside a minute is not an expired session — it is a loop.
 */
const LOOP_WINDOW_MS = 60_000;

/** Whether authentication is known to be gone, so nothing should be sent. */
export function hasSessionEnded(): boolean {
  return ended;
}

/**
 * Whether signing in again was tried and the browser came back still refused.
 *
 * Then the fault is not the operator's session: something is misconfigured — an
 * audience the backend will not accept, a tenant that issues tokens for another
 * API — and no number of round trips through Auth0 will fix it. Saying so and
 * stopping is the only honest answer; looping would hide the cause behind a
 * flashing screen.
 */
export function hasReauthenticationFailed(): boolean {
  return reauthenticationFailed;
}

/**
 * Records that a call succeeded, so a later expiry can sign in again freely.
 *
 * Once anything has been fetched with a working token, whatever went wrong
 * before is over, and the attempt this tab remembers must not count against a
 * genuine expiry an hour later.
 */
export function noteAuthenticationWorks(): void {
  if (attemptForgotten) {
    return;
  }

  attemptForgotten = true;

  try {
    window.sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // Private browsing, or storage disabled. Nothing to forget, and nothing
    // that should stop a request that has just succeeded.
  }
}

/** When this tab last set off for Auth0, or null when it has not. */
function lastAttempt(): number | null {
  try {
    const stamp = Number(window.sessionStorage.getItem(ATTEMPT_KEY));

    return Number.isFinite(stamp) && stamp > 0 ? stamp : null;
  } catch {
    return null;
  }
}

function rememberAttempt(): void {
  try {
    window.sessionStorage.setItem(ATTEMPT_KEY, String(Date.now()));
  } catch {
    // Without storage the loop guard cannot arm, which is a worse outcome than
    // a redirect: signing in is still the right move, so it goes ahead.
  }
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

  const previous = lastAttempt();

  if (previous !== null && Date.now() - previous < LOOP_WINDOW_MS) {
    /*
     * This tab signed in moments ago and is being refused again. Redirecting
     * once more would start the loop the operator actually sees: an error
     * appearing, a navigation, the same error again. The calls stay stopped —
     * the latch is set — and the failure is reported instead of hidden.
     */
    reauthenticationFailed = true;

    return;
  }

  rememberAttempt();
  redirectToLogin();
}
