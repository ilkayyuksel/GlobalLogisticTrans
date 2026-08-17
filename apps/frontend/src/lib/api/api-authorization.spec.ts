import { getAccessToken } from "@/lib/auth/access-token";
import { fetchPdfDocument } from "./pdf-documents";
import { request } from "./client";

const getAccessTokenMock = getAccessToken as jest.MockedFunction<
  typeof getAccessToken
>;

/**
 * Every call to the NestJS API carries the Auth0 access token.
 *
 * The backend refuses an unauthenticated request, so a call that forgets the
 * header fails with a 401 that reads like a permissions problem rather than a
 * missing header. It is attached in one place — `request` — and this pins that
 * down for both the JSON API and the PDF endpoint, which uses a bare `fetch`
 * because it returns bytes rather than the JSON envelope.
 *
 * The token module itself is the suite-wide stub from `jest.setup.ts`; what is
 * under test here is what the client does with what it returns.
 */
function envelope(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, statusCode: 200, data }),
  };
}

function headersOf(call: unknown): Record<string, string> {
  const [, init] = call as [string, { headers?: Record<string, string> }];

  return init?.headers ?? {};
}

describe("API authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAccessTokenMock.mockResolvedValue(null);
  });

  describe("the JSON API", () => {
    it("sends the token as a bearer credential", async () => {
      getAccessTokenMock.mockResolvedValue("access-token-1");
      global.fetch = jest.fn(async () => envelope([])) as unknown as typeof fetch;

      await request("/api/v1/trips");

      expect(headersOf((global.fetch as jest.Mock).mock.calls[0])).toMatchObject(
        { Authorization: "Bearer access-token-1" },
      );
    });

    it("sends it on a write as well as a read", async () => {
      getAccessTokenMock.mockResolvedValue("access-token-1");
      global.fetch = jest.fn(async () => envelope({})) as unknown as typeof fetch;

      await request("/api/v1/trips/trip-1", {
        method: "PATCH",
        body: { containerNumber: "MSKU1234567" },
      });

      const headers = headersOf((global.fetch as jest.Mock).mock.calls[0]);

      expect(headers.Authorization).toBe("Bearer access-token-1");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    /**
     * A multipart body must keep its browser-generated boundary, so the upload
     * path sets no Content-Type — but it still needs the token.
     */
    it("sends it with a file upload, without touching Content-Type", async () => {
      getAccessTokenMock.mockResolvedValue("access-token-1");
      global.fetch = jest.fn(async () => envelope({})) as unknown as typeof fetch;

      await request("/api/v1/pdf-import", {
        method: "POST",
        body: new FormData(),
      });

      const headers = headersOf((global.fetch as jest.Mock).mock.calls[0]);

      expect(headers.Authorization).toBe("Bearer access-token-1");
      expect(headers["Content-Type"]).toBeUndefined();
    });

    /**
     * Not a failure to pre-empt: the backend answers 401, which is correct, and
     * inventing a message here would hide what actually happened.
     */
    it("omits the header when nobody is signed in", async () => {
      global.fetch = jest.fn(async () => envelope([])) as unknown as typeof fetch;

      await request("/api/v1/trips");

      expect(
        headersOf((global.fetch as jest.Mock).mock.calls[0]).Authorization,
      ).toBeUndefined();
    });
  });

  describe("the PDF endpoint", () => {
    it("sends the token", async () => {
      getAccessTokenMock.mockResolvedValue("access-token-1");
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        blob: async () => new Blob(["%PDF-1.7"]),
      })) as unknown as typeof fetch;

      await fetchPdfDocument("pdf-1");

      expect(headersOf((global.fetch as jest.Mock).mock.calls[0])).toEqual({
        Authorization: "Bearer access-token-1",
      });
    });

    it("sends no header when nobody is signed in", async () => {
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        blob: async () => new Blob(["%PDF-1.7"]),
      })) as unknown as typeof fetch;

      await fetchPdfDocument("pdf-1");

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        { headers?: unknown },
      ];

      expect(init.headers).toBeUndefined();
    });
  });
});
