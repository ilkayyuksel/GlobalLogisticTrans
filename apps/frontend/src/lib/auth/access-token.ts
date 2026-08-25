/**
 * The Auth0 access token this browser presents to the NestJS API.
 *
 * ── WHERE IT COMES FROM ─────────────────────────────────────────────────────
 * `/auth/access-token` is mounted by the Auth0 middleware. The session itself
 * lives in an encrypted, http-only cookie that JavaScript cannot read; this
 * endpoint is the SDK's supported way for a browser to obtain the access token
 * that belongs to it, and it refreshes an expired one on the way.
 *
 * It is needed because TRAXO's frontend and backend are separate origins: the
 * browser calls NestJS directly, so the browser is what must carry the token.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── WHY THE TOKEN IS CACHED IN MEMORY ONLY ──────────────────────────────────
 * A page can make several calls at once, and asking the endpoint once per call
 * would triple the traffic. It is held in a module variable — never in
 * localStorage or a cookie of our own, which would outlive the tab and be
 * readable by any script on the page.
 *
 * The expiry is taken from what the endpoint returns rather than by decoding
 * the token: this application must not depend on a token's internals, which
 * belong to Auth0 and to the backend that verifies them.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── WHEN A REFRESH GENUINELY FAILS ──────────────────────────────────────────
 * An expired access token is renewed by the endpoint and nobody notices. An
 * expired or revoked SESSION cannot be renewed by anything, and the endpoint
 * answers 401 — at which point the cached token is dropped and the browser is
 * sent to sign in, because a page that keeps running would show an
 * authentication error on every call while still looking signed in.
 *
 * A failure that is NOT 401 is left alone: the endpoint being down is not the
 * session ending, and the call that follows fails on its own terms.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { redirectToLogin } from "./login-redirect";

const ACCESS_TOKEN_ENDPOINT = "/auth/access-token";

/**
 * Renew slightly early, so a token cannot expire in flight between this
 * check and the backend verifying it.
 */
const EXPIRY_MARGIN_MS = 30_000;

const UNAUTHORIZED = 401;

interface CachedToken {
  token: string;
  /** Epoch milliseconds, already reduced by the margin. */
  usableUntil: number;
}

let cached: CachedToken | null = null;
/** Shared so that concurrent callers make one request, not one each. */
let inFlight: Promise<string | null> | null = null;

/**
 * The current access token, or null when nobody is signed in.
 *
 * Null is an ordinary answer, not a failure: the login page itself renders
 * without a session. The caller sends no Authorization header, and the backend
 * answers 401 — which is exactly what should happen.
 */
export async function getAccessToken(): Promise<string | null> {
  if (cached && Date.now() < cached.usableUntil) {
    return cached.token;
  }

  inFlight ??= fetchAccessToken().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Called after signing out, so a stale token cannot be presented. */
export function forgetAccessToken(): void {
  cached = null;
}

async function fetchAccessToken(): Promise<string | null> {
  let response: Response;

  try {
    response = await fetch(ACCESS_TOKEN_ENDPOINT, {
      // The session cookie is what identifies the caller to this endpoint.
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch {
    // Offline, or the endpoint is unreachable. Treated as "no token": the
    // backend call that follows will fail on its own terms, with its own
    // message, rather than this inventing one.
    return null;
  }

  if (!response.ok) {
    cached = null;

    /*
     * 401 is the endpoint's way of saying the SESSION is gone — the refresh
     * token has expired, been revoked, or there was never one. No amount of
     * retrying fixes that, and a page left running would show an error on every
     * call while looking signed in, so the browser is sent to sign in again.
     *
     * Only 401. A 500 or a gateway error is the endpoint failing, not the
     * session ending, and bouncing somebody to a login page for a transient
     * fault would lose the work in front of them.
     *
     * This is NOT a logout: nothing calls /auth/logout and the Auth0 session is
     * not ended here. It is a request to sign in, which is what a browser with
     * no session has to do.
     */
    if (response.status === UNAUTHORIZED) {
      redirectToLogin();
    }

    return null;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!isTokenResponse(payload)) {
    cached = null;

    return null;
  }

  cached = {
    token: payload.token,
    usableUntil: payload.expires_at * 1000 - EXPIRY_MARGIN_MS,
  };

  return payload.token;
}

/**
 * The SDK's `AccessTokenResponse`: `token`, plus `expires_at` in SECONDS since
 * the epoch. Both are checked rather than assumed — this is a network response,
 * and a token cached with a misread expiry would be presented after it died.
 */
function isTokenResponse(
  payload: unknown,
): payload is { token: string; expires_at: number } {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as { token?: unknown; expires_at?: unknown };

  return (
    typeof candidate.token === "string" &&
    candidate.token !== "" &&
    typeof candidate.expires_at === "number"
  );
}
