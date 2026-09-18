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
/**
 * jsdom's Blob predates `Blob.arrayBuffer()`, which every browser the app
 * supports has had for years. The PDF viewer reads the fetched document through
 * it, so without this shim the specs would test a Blob no browser ships. It
 * reads through jsdom's own FileReader, so the bytes are the Blob's real bytes.
 */
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

jest.mock("@/lib/auth/access-token", () => ({
  getAccessToken: jest.fn(async () => null),
  forgetAccessToken: jest.fn(),
  // A renewal that produces nothing, which is what "no session" means. The
  // real module is exercised by the auth specs, which unmock it.
  renewAccessToken: jest.fn(async () => null),
}));
