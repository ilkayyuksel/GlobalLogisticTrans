import "@testing-library/jest-dom";

/**
 * The API client reads its base URL from the environment and refuses to work
 * without one, exactly as it would in a browser. Setting it here means tests
 * exercise the real code path rather than a special case for tests.
 */
process.env.NEXT_PUBLIC_API_URL = "http://backend.test";

/**
 * No Auth0 session, unless a test arranges one.
 *
 * Every backend call now asks `/auth/access-token` for a bearer token, which in
 * a browser is served by the Auth0 middleware. Under jsdom there is no such
 * endpoint, so without this each spec's `fetch` mock would see an extra request
 * it never made an assertion about — and dozens of specs that are about Trips
 * would start failing over authentication plumbing.
 *
 * Returning null is the honest default: the tests render components, not a
 * signed-in session. The header this produces (none) is what the code does when
 * nobody is signed in, and `access-token.spec.ts` and `api-authorization.spec.ts`
 * test the real module and the real header without this mock.
 */
jest.mock("@/lib/auth/access-token", () => ({
  getAccessToken: jest.fn(async () => null),
  forgetAccessToken: jest.fn(),
}));
