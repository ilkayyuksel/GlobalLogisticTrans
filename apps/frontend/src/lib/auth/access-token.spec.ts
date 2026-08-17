/**
 * The access token the browser presents to the NestJS API.
 *
 * The real module, not the suite-wide stub: `jest.setup.ts` mocks this module
 * for every other spec so that Trip tests are not about authentication, and
 * this is one of the two places the genuine behaviour is exercised.
 */
jest.unmock("@/lib/auth/access-token");

const ONE_HOUR_FROM_NOW = () => Math.floor(Date.now() / 1000) + 3600;

function respondWithToken(token: string, expiresAt = ONE_HOUR_FROM_NOW()) {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ token, expires_at: expiresAt }),
  })) as unknown as jest.MockedFunction<typeof fetch>;
}

describe("getAccessToken", () => {
  let getAccessToken: typeof import("./access-token").getAccessToken;
  let forgetAccessToken: typeof import("./access-token").forgetAccessToken;

  beforeEach(async () => {
    // The module caches the token in a variable, so each test needs a fresh
    // copy of it — otherwise one test's token would satisfy the next.
    jest.resetModules();

    const module_ = await import("./access-token");
    getAccessToken = module_.getAccessToken;
    forgetAccessToken = module_.forgetAccessToken;
  });

  it("asks the Auth0 middleware's endpoint", async () => {
    global.fetch = respondWithToken("token-1");

    expect(await getAccessToken()).toBe("token-1");
    expect(global.fetch).toHaveBeenCalledWith(
      "/auth/access-token",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  /** Several widgets load at once; they must not each fetch a token. */
  it("makes one request for concurrent callers", async () => {
    global.fetch = respondWithToken("token-1");

    const tokens = await Promise.all([
      getAccessToken(),
      getAccessToken(),
      getAccessToken(),
    ]);

    expect(tokens).toEqual(["token-1", "token-1", "token-1"]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("reuses a token that is still valid", async () => {
    global.fetch = respondWithToken("token-1");

    await getAccessToken();
    await getAccessToken();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  /** A token that expires between here and the backend is a 401 nobody caused. */
  it("fetches again once the token is nearly expired", async () => {
    global.fetch = respondWithToken(
      "token-1",
      Math.floor(Date.now() / 1000) + 10,
    );

    await getAccessToken();
    await getAccessToken();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  describe("when nobody is signed in", () => {
    it("answers null rather than throwing", async () => {
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
      })) as unknown as typeof fetch;

      expect(await getAccessToken()).toBeNull();
    });

    it("answers null when the endpoint cannot be reached", async () => {
      global.fetch = jest.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch;

      expect(await getAccessToken()).toBeNull();
    });

    it("answers null for a response it cannot read", async () => {
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: true }),
      })) as unknown as typeof fetch;

      expect(await getAccessToken()).toBeNull();
    });
  });

  it("forgets the token when asked", async () => {
    global.fetch = respondWithToken("token-1");

    await getAccessToken();
    forgetAccessToken();
    await getAccessToken();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  /**
   * The token lives in memory for the life of the page and nowhere else.
   * Anything persisted outlives the tab and is readable by any script on it.
   */
  it("never writes the token to storage", async () => {
    global.fetch = respondWithToken("token-1");

    await getAccessToken();

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain("token-1");
  });
});
