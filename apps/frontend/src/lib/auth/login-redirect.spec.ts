/**
 * @jest-environment node
 */

/**
 * Sending a browser to sign in, where there is no browser.
 *
 * ── WHAT THIS FILE CAN AND CANNOT PROVE ─────────────────────────────────────
 * The navigation itself is not observable under jsdom: `window.location` can be
 * neither replaced nor spied on, and `assign` is read-only. So the fact that a
 * failed renewal ASKS for a redirect is asserted where it is decided — see
 * `session-renewal.spec.ts`, which mocks this module — and the redirect landing
 * an operator on the login page is confirmed in the browser instead.
 *
 * What IS provable here is the branch that has no browser at all. This module
 * is imported by the API client, which is imported by server components, so a
 * bare `window.location.assign` would crash a server render the first time a
 * token could not be fetched — a failure that would appear as a broken page
 * rather than as a login screen.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.unmock("@/lib/auth/login-redirect");

describe("redirectToLogin on the server", () => {
  it("does nothing rather than reaching for a window", async () => {
    const { redirectToLogin } = await import("./login-redirect");

    expect(typeof window).toBe("undefined");
    expect(() => redirectToLogin()).not.toThrow();
  });

  it("names the same entry page the middleware redirects to", async () => {
    const { LOGIN_PAGE } = await import("./login-redirect");

    expect(LOGIN_PAGE).toBe("/auth");
  });
});
