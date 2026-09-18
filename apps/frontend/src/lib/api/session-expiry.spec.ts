/**
 * What the application does when authentication runs out underneath it.
 *
 * ── THE SITUATION BEING REPRODUCED ──────────────────────────────────────────
 * A tab is left open overnight. The operator comes back to a page that is still
 * on screen and still asking the backend for things, and every one of those
 * questions is now answered "401". What they used to see was that answer
 * repeated: error panels appearing, requests going out again, and no way back
 * in except a manual refresh.
 *
 * So these tests are about a whole failing browser rather than one function.
 * The real token module and the real client run together over a fake network,
 * and what is asserted is what an operator would notice — whether the calls
 * stop, and whether the browser leaves for the login page exactly once.
 *
 * ── THE DISTINCTION THAT MATTERS MOST ───────────────────────────────────────
 * An access token expiring is ordinary and must cost nobody their place: the
 * endpoint mints a new one and the interrupted call simply goes again. Only a
 * SESSION that cannot be renewed is a reason to sign in again. Both are here,
 * next to each other, because confusing them either strands an operator on a
 * dead page or throws them out in the middle of their work.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.unmock("@/lib/auth/access-token");

/*
 * jsdom locks `window.location` down completely, so the navigation is observed
 * at the module whose job it is — the same arrangement `session-renewal.spec.ts`
 * uses. Where that navigation POINTS is proven in `login-redirect.spec.ts`.
 */
jest.mock("@/lib/auth/login-redirect", () => ({
  LOGIN_PAGE: "/auth",
  redirectToLogin: jest.fn(),
}));

const TOKEN_ENDPOINT = "/auth/access-token";
const AN_HOUR = 3600;

interface Network {
  /** Every call the browser made, so a test can say what was NOT sent. */
  readonly calls: { token: number; api: number };
  /** The bearer token presented on each API call, in order. */
  readonly presented: (string | null)[];
}

interface Server {
  /** Whether `/auth/access-token` can still produce a token. */
  session: "alive" | "gone";
  /** Tokens the backend accepts. Omitted: it accepts whatever it is given. */
  accepts?: readonly string[];
  /** A failure that is not about authentication at all. */
  fails?: { status: number; code: string };
  /** The backend cannot be reached. */
  offline?: boolean;
}

/** Puts a fake Auth0 endpoint and a fake backend behind `fetch`. */
function serve(server: Server): Network {
  const calls = { token: 0, api: 0 };
  const presented: (string | null)[] = [];
  let issued = 0;

  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith(TOKEN_ENDPOINT)) {
      calls.token += 1;

      if (server.session === "gone") {
        return { ok: false, status: 401, json: async () => ({}) };
      }

      issued += 1;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          token: `token-${issued}`,
          expires_at: Math.floor(Date.now() / 1000) + AN_HOUR,
        }),
      };
    }

    calls.api += 1;

    if (server.offline) {
      throw new TypeError("Failed to fetch");
    }

    const bearer = readBearer(init);
    presented.push(bearer);

    if (server.fails) {
      return envelope(server.fails.status, server.fails.code);
    }

    const accepted =
      server.accepts === undefined ||
      (bearer !== null && server.accepts.includes(bearer));

    return accepted
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            statusCode: 200,
            data: { ok: true },
          }),
        }
      : envelope(401, "UNAUTHORIZED");
  }) as unknown as typeof fetch;

  return { calls, presented };
}

function envelope(status: number, code: string) {
  return {
    ok: false,
    status,
    json: async () => ({
      success: false,
      statusCode: status,
      error: { code, message: "The backend said no." },
    }),
  };
}

function readBearer(init?: RequestInit): string | null {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const header = headers.Authorization;

  return typeof header === "string" ? header.replace("Bearer ", "") : null;
}

describe("when authentication runs out", () => {
  let request: typeof import("./client").request;
  let isSessionEndedError: typeof import("./client").isSessionEndedError;
  let ApiError: typeof import("./client").ApiError;
  let redirectToLogin: jest.MockedFunction<
    typeof import("@/lib/auth/login-redirect").redirectToLogin
  >;

  /** The failure a caller got, whatever it turned out to be. */
  async function failureOf(pending: Promise<unknown>): Promise<unknown> {
    return pending.then(
      () => {
        throw new Error("Expected the call to fail, but it succeeded.");
      },
      (caught: unknown) => caught,
    );
  }

  beforeEach(async () => {
    /*
     * The token cache and the "session has ended" latch are module state, and a
     * browser that has given up stays given up — which is the point of the
     * latch. Each test therefore needs a browser that has just opened.
     */
    jest.resetModules();

    const client = await import("./client");
    request = client.request;
    isSessionEndedError = client.isSessionEndedError;
    ApiError = client.ApiError;

    redirectToLogin = (await import("@/lib/auth/login-redirect"))
      .redirectToLogin as jest.MockedFunction<
      typeof import("@/lib/auth/login-redirect").redirectToLogin
    >;
    redirectToLogin.mockClear();
  });

  describe("a session that is still good", () => {
    it("answers, and sends nobody to the login page", async () => {
      serve({ session: "alive" });

      await expect(request("/api/v1/trips")).resolves.toEqual({ ok: true });
      expect(redirectToLogin).not.toHaveBeenCalled();
    });
  });

  /**
   * The ordinary case, and the one that must never sign anyone out: the token
   * aged out while the tab was asleep. The endpoint mints a new one from the
   * refresh token and the call the operator is waiting for simply goes again.
   */
  describe("an access token the backend refuses, with a live session behind it", () => {
    it("renews it and lets the call through, with no login in sight", async () => {
      const network = serve({ session: "alive", accepts: ["token-2"] });

      await expect(request("/api/v1/trips")).resolves.toEqual({ ok: true });

      expect(network.presented).toEqual(["token-1", "token-2"]);
      expect(redirectToLogin).not.toHaveBeenCalled();
    });

    it("renews once rather than hammering the endpoint", async () => {
      const network = serve({ session: "alive", accepts: ["token-2"] });

      await request("/api/v1/trips");

      expect(network.calls.token).toBe(2);
      expect(network.calls.api).toBe(2);
    });
  });

  describe("a session that cannot be renewed", () => {
    it("sends the browser to sign in", async () => {
      serve({ session: "gone" });

      expect(await failureOf(request("/api/v1/trips"))).toBeInstanceOf(ApiError);
      expect(redirectToLogin).toHaveBeenCalledTimes(1);
    });

    /** Not an error about the Trips; the page is leaving, and says so. */
    it("fails with a session-ended error rather than an authentication one", async () => {
      serve({ session: "gone" });

      expect(
        isSessionEndedError(await failureOf(request("/api/v1/trips"))),
      ).toBe(true);
    });

    /** Nothing is sent to a backend that could only refuse it. */
    it("does not call the backend at all", async () => {
      const network = serve({ session: "gone" });

      await failureOf(request("/api/v1/trips"));

      expect(network.calls.api).toBe(0);
    });

    /**
     * The polling case. A page that asks every few seconds must go quiet the
     * moment authentication is gone, rather than producing a 401 per tick.
     */
    it("stops sending anything afterwards", async () => {
      const network = serve({ session: "gone" });

      await failureOf(request("/api/v1/trips"));
      const afterFirst = network.calls.token + network.calls.api;

      for (let tick = 0; tick < 5; tick += 1) {
        expect(
          isSessionEndedError(await failureOf(request("/api/v1/trips"))),
        ).toBe(true);
      }

      expect(network.calls.token + network.calls.api).toBe(afterFirst);
      expect(redirectToLogin).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * A token the backend keeps refusing while the endpoint keeps issuing them.
   * Two attempts and a decision — never a loop.
   */
  describe("a token that is refused even after renewal", () => {
    it("gives up instead of trying again", async () => {
      const network = serve({ session: "alive", accepts: [] });

      expect(
        isSessionEndedError(await failureOf(request("/api/v1/trips"))),
      ).toBe(true);
      expect(network.calls.api).toBe(2);
      expect(redirectToLogin).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The Dashboard: counts, recent Trips, today's agenda, driver statistics and
   * maintenance warnings, all failing within the same second.
   */
  describe("ten widgets failing together", () => {
    it("produce exactly one redirect", async () => {
      serve({ session: "gone" });

      await Promise.all(
        Array.from({ length: 10 }, () =>
          request("/api/v1/trips").catch(() => undefined),
        ),
      );

      expect(redirectToLogin).toHaveBeenCalledTimes(1);
    });

    it("ask the token endpoint once between them", async () => {
      const network = serve({ session: "gone" });

      await Promise.all(
        Array.from({ length: 10 }, () =>
          request("/api/v1/trips").catch(() => undefined),
        ),
      );

      expect(network.calls.token).toBe(1);
      expect(network.calls.api).toBe(0);
    });
  });

  /**
   * ── WHAT MUST NOT SIGN ANYONE OUT ─────────────────────────────────────────
   * Everything that is not the guard refusing a token. A validation failure, a
   * missing Trip, a conflict, a rate limit, a broken backend and a dropped
   * connection are all ordinary outcomes that pages already handle, and turning
   * any of them into a login screen would throw work away for nothing.
   */
  describe("failures that are not about authentication", () => {
    it.each([
      [400, "BAD_REQUEST"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
      [422, "UNPROCESSABLE_ENTITY"],
      [429, "TOO_MANY_REQUESTS"],
      [500, "INTERNAL_SERVER_ERROR"],
    ])("leave a %s where it is", async (status, code) => {
      serve({
        session: "alive",
        fails: { status: status as number, code: code as string },
      });

      const error = await failureOf(request("/api/v1/trips"));

      expect(error).toBeInstanceOf(ApiError);
      expect((error as InstanceType<typeof ApiError>).code).toBe(code);
      expect(redirectToLogin).not.toHaveBeenCalled();
    });

    it("leave a network failure where it is", async () => {
      serve({ session: "alive", offline: true });

      const error = await failureOf(request("/api/v1/trips"));

      expect((error as InstanceType<typeof ApiError>).code).toBe(
        "NETWORK_ERROR",
      );
      expect(redirectToLogin).not.toHaveBeenCalled();
    });
  });
});
