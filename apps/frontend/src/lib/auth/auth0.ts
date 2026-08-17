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
export const auth0 = new Auth0Client({
  authorizationParameters: {
    /*
     * The API the returned access token is FOR.
     *
     * Without an audience Auth0 issues an opaque token, which the backend
     * cannot verify — it would reject every request while the user appeared to
     * be signed in perfectly. `openid profile email` is the minimum needed to
     * show who is signed in; `offline_access` lets the SDK refresh the token
     * without sending the operator back through a login screen mid-shift.
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
