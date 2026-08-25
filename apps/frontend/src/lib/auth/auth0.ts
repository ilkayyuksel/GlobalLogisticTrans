import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * The Auth0 client, configured once for the whole application.
 *
 * ── WHAT THIS APPLICATION DOES AND DOES NOT DO ──────────────────────────────
 * It never sees a password. Credentials are entered on Auth0's Universal Login
 * page, on Auth0's domain; this application only starts that flow, receives the
 * result and holds an encrypted session cookie. There is no registration, no
 * password reset and no credential handling anywhere in this codebase, and none
 * may be added — TRAXO V1 has exactly one administrator, created in the Auth0
 * dashboard.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── THE ROUTES THIS MOUNTS ──────────────────────────────────────────────────
 * The SDK's middleware serves these; no route handler is written by hand:
 *   /auth/login          → redirects to Universal Login
 *   /auth/callback       → completes the flow and sets the session cookie
 *   /auth/logout         → ends the Auth0 session, returns to the app
 *   /auth/profile        → the signed-in user, for `useUser()`
 *   /auth/access-token   → the access token, for calls to the NestJS API
 *
 * Our own branded page lives at `/auth` exactly, which does not collide with
 * any of them.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Configuration comes from the environment: AUTH0_DOMAIN, AUTH0_CLIENT_ID,
 * AUTH0_CLIENT_SECRET, AUTH0_SECRET and APP_BASE_URL are read by the SDK
 * itself. Nothing here holds a secret, and no secret is exposed through a
 * NEXT_PUBLIC_* variable — the client secret stays server-side by construction,
 * because this module is only ever imported by middleware and server code.
 */
const SECONDS_PER_DAY = 60 * 60 * 24;

/**
 * How long a signed-in session survives, and why these numbers.
 *
 * ── THIS IS THE SESSION, NOT THE ACCESS TOKEN ───────────────────────────────
 * The access token stays short-lived and is refreshed by the SDK through the
 * refresh token that `offline_access` obtains. Nothing here extends a token's
 * validity — these bound the encrypted SESSION COOKIE, which is what says the
 * browser may ask for a refreshed token at all.
 *
 * The SDK's defaults are three days absolute and one day of inactivity, and
 * they are why an operator was sent back to Universal Login: the absolute
 * ceiling ends a session on the third day however continuously it has been
 * used, and a long weekend crosses the inactivity limit on its own. Refresh
 * tokens never came into it — the cookie carrying the session was already gone.
 *
 * ── THE NUMBERS ────────────────────────────────────────────────────────────
 * INACTIVITY covers a weekend and a public holiday either side of it, so a
 * planner who leaves on Friday afternoon is still signed in on Tuesday morning.
 *
 * ABSOLUTE is a real ceiling and deliberately not "forever": a session that
 * could never age out would keep a stolen laptop signed in indefinitely. Thirty
 * days means the longest-lived session in the system is a month old, and an
 * operator signs in roughly once a month rather than twice a week.
 *
 * Rolling is left at the SDK's default of true, which is what makes the
 * inactivity window a window rather than a countdown from login.
 * ────────────────────────────────────────────────────────────────────────────
 */
const SESSION_INACTIVITY_SECONDS = 7 * SECONDS_PER_DAY;
const SESSION_ABSOLUTE_SECONDS = 30 * SECONDS_PER_DAY;

export const auth0 = new Auth0Client({
  authorizationParameters: {
    /*
     * The API the returned access token is FOR.
     *
     * Without an audience Auth0 issues an opaque token, which the backend
     * cannot verify — it would reject every request while the user appeared to
     * be signed in perfectly. `openid profile email` is the minimum needed to
     * show who is signed in.
     *
     * `offline_access` asks for a REFRESH TOKEN, which is what lets the SDK
     * mint a new access token when the old one expires, without sending the
     * operator back through a login screen mid-shift. It only produces one if
     * the API in the Auth0 dashboard has "Allow Offline Access" enabled —
     * without that, Auth0 ignores the scope silently and the session ends when
     * the first access token does.
     */
    audience: process.env.AUTH0_AUDIENCE,
    scope: "openid profile email offline_access",
  },

  /**
   * Where a completed login lands.
   *
   * The dashboard rather than "/", because "/" only redirects onward and the
   * extra hop is visible as a flash.
   */
  signInReturnToPath: "/dashboard",

  /*
   * Stated rather than left to the SDK's defaults, which are three days
   * absolute and one day idle — short enough that an operator was signed out
   * mid-week. See the note above each value.
   */
  session: {
    inactivityDuration: SESSION_INACTIVITY_SECONDS,
    absoluteDuration: SESSION_ABSOLUTE_SECONDS,
  },
});

/**
 * Whether Auth0 is configured at all.
 *
 * The tenant is provisioned outside this repository, so a checkout can be
 * complete and correct while the variables are still empty. Rather than crash
 * on a missing secret, the application says plainly that authentication is not
 * configured — which is the truth, and is far easier to act on than a stack
 * trace from inside the SDK.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
      process.env.AUTH0_CLIENT_ID &&
      process.env.AUTH0_CLIENT_SECRET &&
      process.env.AUTH0_SECRET &&
      process.env.APP_BASE_URL,
  );
}
