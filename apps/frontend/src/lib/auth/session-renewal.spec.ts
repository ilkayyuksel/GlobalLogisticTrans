/**
 * Staying signed in across an expiring access token.
 *
 * ── WHAT THIS IS ABOUT ──────────────────────────────────────────────────────
 * An access token is deliberately short-lived. What must NOT be short-lived is
 * the operator's day: when the token dies the SDK's `/auth/access-token`
 * endpoint mints a new one from the refresh token, and nobody sees a login
 * screen. These tests drive that whole lifecycle over a clock that really moves
 * — a token that never expires would prove nothing.
 *
 * ── AND WHEN RENEWAL GENUINELY FAILS ────────────────────────────────────────
 * A refresh token that has expired or been revoked cannot be renewed by
 * anything. The endpoint answers 401, the cached token is dropped, and the
 * browser is sent to sign in — rather than left on a page that looks signed in
 * and fails every call. A failure that is not a 401 is the endpoint being down,
 * which is a different thing and must not throw anyone out.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.unmock("@/lib/auth/access-token");

/*
 * jsdom locks `window.location` down completely — it can be neither replaced
 * nor spied on — so the navigation is observed where it belongs: at the module
 * whose job it is. See `login-redirect.ts`.
 */
jest.mock("@/lib/auth/login-redirect", () => ({
  LOGIN_PAGE: "/auth",
  redirectToLogin: jest.fn(),
}));

const SECOND = 1000;

/** Epoch SECONDS, which is what the SDK's endpoint returns. */
function secondsFromNow(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

interface Endpoint {
  fetch: jest.MockedFunction<typeof fetch>;
  /** Every token the endpoint has handed out, in order. */
  issued: string[];
}

/**
 * The endpoint as Auth0 implements it: it always answers with a token that is
 * valid from now, because renewing is exactly what it does on the way.
 */
function renewingEndpoint(lifetimeSeconds = 60): Endpoint {
  const issued: string[] = [];

  const mock = jest.fn(async () => {
    const token = `token-${issued.length + 1}`;
    issued.push(token);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        token,
        expires_at: secondsFromNow(lifetimeSeconds),
      }),
    };
  }) as unknown as jest.MockedFunction<typeof fetch>;

  return { fetch: mock, issued };
}

function refusingEndpoint(status: number): jest.MockedFunction<typeof fetch> {
  return jest.fn(async () => ({
    ok: false,
    status,
    json: async () => ({}),
  })) as unknown as jest.MockedFunction<typeof fetch>;
}

describe("staying signed in", () => {
  let getAccessToken: typeof import("./access-token").getAccessToken;
  let redirectToLogin: jest.MockedFunction<
    typeof import("./login-redirect").redirectToLogin
  >;

  beforeEach(async () => {
    // The module caches in a variable, so each test needs a fresh copy.
    jest.resetModules();
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
    jest.setSystemTime(new Date("2026-08-25T09:00:00.000Z"));

    getAccessToken = (await import("./access-token")).getAccessToken;
    redirectToLogin = (await import("./login-redirect"))
      .redirectToLogin as jest.MockedFunction<
      typeof import("./login-redirect").redirectToLogin
    >;
    redirectToLogin.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("while the token is valid", () => {
    it("presents the token the endpoint issued", async () => {
      const endpoint = renewingEndpoint();
      global.fetch = endpoint.fetch;

      expect(await getAccessToken()).toBe("token-1");
    });

    it("asks the endpoint once, however many calls the page makes", async () => {
      const endpoint = renewingEndpoint();
      global.fetch = endpoint.fetch;

      await getAccessToken();
      await getAccessToken();
      await getAccessToken();

      expect(endpoint.fetch).toHaveBeenCalledTimes(1);
      expect(endpoint.issued).toEqual(["token-1"]);
    });

    it("keeps using it right up to the renewal margin", async () => {
      const endpoint = renewingEndpoint(60);
      global.fetch = endpoint.fetch;

      await getAccessToken();
      // 25s in: still inside the 60s lifetime and outside the 30s margin.
      jest.advanceTimersByTime(25 * SECOND);

      expect(await getAccessToken()).toBe("token-1");
      expect(endpoint.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the access token expires", () => {
    it("renews it without anybody signing in", async () => {
      const endpoint = renewingEndpoint(60);
      global.fetch = endpoint.fetch;

      expect(await getAccessToken()).toBe("token-1");

      // Past the token's life entirely.
      jest.advanceTimersByTime(90 * SECOND);

      expect(await getAccessToken()).toBe("token-2");
      expect(redirectToLogin).not.toHaveBeenCalled();
    });

    /** Renewed BEFORE it dies, so a call cannot carry an expired token. */
    it("renews inside the margin, before the token actually dies", async () => {
      const endpoint = renewingEndpoint(60);
      global.fetch = endpoint.fetch;

      await getAccessToken();
      // 40s in: the token is still alive, but inside the 30s margin.
      jest.advanceTimersByTime(40 * SECOND);

      expect(await getAccessToken()).toBe("token-2");
    });

    it("stays authenticated across several renewals", async () => {
      const endpoint = renewingEndpoint(60);
      global.fetch = endpoint.fetch;

      const collected: (string | null)[] = [];

      for (let hour = 0; hour < 5; hour += 1) {
        collected.push(await getAccessToken());
        jest.advanceTimersByTime(90 * SECOND);
      }

      expect(collected).toEqual([
        "token-1",
        "token-2",
        "token-3",
        "token-4",
        "token-5",
      ]);
      // Never once sent to sign in.
      expect(redirectToLogin).not.toHaveBeenCalled();
    });

    /** A renewal is one request, not one per waiting caller. */
    it("renews once for callers that expire together", async () => {
      const endpoint = renewingEndpoint(60);
      global.fetch = endpoint.fetch;

      await getAccessToken();
      jest.advanceTimersByTime(90 * SECOND);

      const [first, second, third] = await Promise.all([
        getAccessToken(),
        getAccessToken(),
        getAccessToken(),
      ]);

      expect([first, second, third]).toEqual([
        "token-2",
        "token-2",
        "token-2",
      ]);
      expect(endpoint.fetch).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * The session itself is gone: the refresh token expired, was revoked, or
   * never existed. Nothing can renew it, so the operator has to sign in.
   */
  describe("when renewal genuinely fails", () => {
    it("presents no token", async () => {
      global.fetch = refusingEndpoint(401);

      expect(await getAccessToken()).toBeNull();
    });

    it("sends the browser to sign in", async () => {
      global.fetch = refusingEndpoint(401);

      await getAccessToken();

      expect(redirectToLogin).toHaveBeenCalled();
    });

    /** The invalid token is dropped, so nothing can present it afterwards. */
    it("forgets the token it was holding", async () => {
      const endpoint = renewingEndpoint(60);
      global.fetch = endpoint.fetch;
      await getAccessToken();

      jest.advanceTimersByTime(90 * SECOND);
      global.fetch = refusingEndpoint(401);

      expect(await getAccessToken()).toBeNull();
      expect(await getAccessToken()).toBeNull();
    });

    /** Whether going there would help is the redirect module's own rule. */
    it("asks to sign in exactly once per failed renewal", async () => {
      global.fetch = refusingEndpoint(401);

      await getAccessToken();

      expect(redirectToLogin).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The endpoint failing is not the session ending. Throwing an operator out
   * over a transient fault would lose the work in front of them.
   */
  describe("when the endpoint is merely unwell", () => {
    it.each([500, 502, 503])("keeps them where they are on a %s", async (status) => {
      global.fetch = refusingEndpoint(status);

      expect(await getAccessToken()).toBeNull();
      expect(redirectToLogin).not.toHaveBeenCalled();
    });

    it("keeps them where they are when the network is down", async () => {
      global.fetch = jest.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as jest.MockedFunction<typeof fetch>;

      expect(await getAccessToken()).toBeNull();
      expect(redirectToLogin).not.toHaveBeenCalled();
    });

    /** And it recovers by itself once the endpoint answers again. */
    it("renews again once the endpoint recovers", async () => {
      global.fetch = refusingEndpoint(503);
      expect(await getAccessToken()).toBeNull();

      const endpoint = renewingEndpoint(60);
      global.fetch = endpoint.fetch;

      expect(await getAccessToken()).toBe("token-1");
    });
  });

  /** A refresh token is a credential. It never reaches this side at all. */
  describe("what is never held here", () => {
    it("stores nothing outside the module", async () => {
      const endpoint = renewingEndpoint();
      global.fetch = endpoint.fetch;

      await getAccessToken();

      expect(window.localStorage.length).toBe(0);
      expect(window.sessionStorage.length).toBe(0);
      expect(document.cookie).toBe("");
    });

    it("asks for the token with the session cookie and nothing else", async () => {
      const endpoint = renewingEndpoint();
      global.fetch = endpoint.fetch;

      await getAccessToken();

      const [, options] = endpoint.fetch.mock.calls[0] as [string, RequestInit];

      expect(options.credentials).toBe("same-origin");
      expect(JSON.stringify(options)).not.toMatch(/refresh/i);
    });
  });
});
