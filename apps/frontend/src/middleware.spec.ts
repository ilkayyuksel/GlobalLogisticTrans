/**
 * Runs in the node environment, not jsdom.
 *
 * `next/server` needs the platform's Request, Response and Headers, which jsdom
 * does not provide. This is server code, so the server environment is also the
 * honest one to test it in.
 *
 * @jest-environment node
 */

import { NextRequest, NextResponse } from "next/server";

import { auth0, isAuthConfigured } from "@/lib/auth/auth0";
import { middleware } from "./middleware";

jest.mock("@/lib/auth/auth0", () => ({
  auth0: {
    middleware: jest.fn(),
    getSession: jest.fn(),
  },
  isAuthConfigured: jest.fn(() => true),
}));

const auth0Mock = auth0 as unknown as {
  middleware: jest.Mock;
  getSession: jest.Mock;
};
const isAuthConfiguredMock = isAuthConfigured as jest.MockedFunction<
  typeof isAuthConfigured
>;

/**
 * Who may see what.
 *
 * This is the layer that decides which PAGES a browser is shown. It is not what
 * guards the data — the NestJS API verifies the access token on every call, and
 * would refuse an unauthenticated request no matter what happened here — but a
 * hole here would show an operator a working-looking application full of empty
 * tables, which is its own kind of broken.
 */
function requestFor(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3100"));
}

function signedIn(): void {
  auth0Mock.getSession.mockResolvedValue({ user: { sub: "auth0|admin" } });
}

function signedOut(): void {
  auth0Mock.getSession.mockResolvedValue(null);
}

describe("middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isAuthConfiguredMock.mockReturnValue(true);
    auth0Mock.middleware.mockResolvedValue(NextResponse.next());
  });

  describe("a visitor who is not signed in", () => {
    beforeEach(signedOut);

    it.each([
      ["/dashboard"],
      ["/trips"],
      ["/trips/trip-1"],
      ["/vehicles"],
      ["/maintenance"],
      ["/imports"],
      ["/settings/custom-values"],
      ["/settings/license-plates"],
      ["/"],
    ])("is sent from %s to the TRAXO entry page", async (path) => {
      const response = await middleware(requestFor(path));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/auth");
    });

    /** A bookmarked deep link should survive signing in. */
    it("remembers where they were going", async () => {
      const response = await middleware(requestFor("/trips?view=week"));
      const location = new URL(response.headers.get("location") as string);

      expect(location.pathname).toBe("/auth");
      expect(location.searchParams.get("returnTo")).toBe("/trips?view=week");
    });

    it("may see the entry page itself", async () => {
      const response = await middleware(requestFor("/auth"));

      expect(response.status).toBe(200);
    });

    /** The SDK owns these; it has already produced the answer. */
    it.each([
      ["/auth/login"],
      ["/auth/callback"],
      ["/auth/logout"],
      ["/auth/access-token"],
    ])("does not interfere with %s", async (path) => {
      const sdkResponse = NextResponse.next();
      auth0Mock.middleware.mockResolvedValue(sdkResponse);

      expect(await middleware(requestFor(path))).toBe(sdkResponse);
      expect(auth0Mock.getSession).not.toHaveBeenCalled();
    });
  });

  describe("a signed-in administrator", () => {
    beforeEach(signedIn);

    it.each([["/dashboard"], ["/trips"], ["/vehicles"], ["/maintenance"]])(
      "may open %s",
      async (path) => {
        const response = await middleware(requestFor(path));

        expect(response.status).toBe(200);
      },
    );

    /** A login page for someone already signed in is a dead end. */
    it("is moved off the entry page to the dashboard", async () => {
      const response = await middleware(requestFor("/auth"));

      expect(response.status).toBe(307);
      expect(
        new URL(response.headers.get("location") as string).pathname,
      ).toBe("/dashboard");
    });
  });

  /**
   * The tenant is provisioned outside this repository. Rather than fail every
   * page with an internal error from inside the SDK, an unconfigured checkout
   * stays usable and the entry page explains itself.
   */
  describe("before Auth0 is configured", () => {
    it("lets requests through without consulting the SDK", async () => {
      isAuthConfiguredMock.mockReturnValue(false);

      const response = await middleware(requestFor("/dashboard"));

      expect(response.status).toBe(200);
      expect(auth0Mock.middleware).not.toHaveBeenCalled();
    });
  });

  /**
   * The SDK's middleware has to run on every request it is given: it is what
   * refreshes the rolling session cookie, so skipping it would sign an operator
   * out mid-shift.
   */
  it("always lets the SDK see the request first", async () => {
    signedIn();

    await middleware(requestFor("/trips"));

    expect(auth0Mock.middleware).toHaveBeenCalledTimes(1);
  });
});
