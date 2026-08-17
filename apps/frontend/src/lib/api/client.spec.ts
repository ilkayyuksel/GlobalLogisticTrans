import { ApiError, request, userFacingMessage } from "./client";

/**
 * The API client.
 *
 * `fetch` is replaced, so these tests are about how the client interprets what
 * a server says — the envelope, the failure shapes, the query string — rather
 * than about the network.
 */

const BASE_URL = "http://backend.test";

/**
 * Awaits a call that is expected to fail and returns its ApiError.
 *
 * Fails the test if the call succeeds or throws something else, so the
 * assertions that follow can rely on the type instead of casting an `unknown`.
 */
async function catchApiError(pending: Promise<unknown>): Promise<ApiError> {
  try {
    await pending;
  } catch (caught: unknown) {
    if (caught instanceof ApiError) {
      return caught;
    }

    throw new Error(`Expected an ApiError but got: ${String(caught)}`, {
      cause: caught,
    });
  }

  throw new Error("Expected the call to fail, but it succeeded.");
}

function successEnvelope(data: unknown, statusCode = 200) {
  return {
    ok: true,
    status: statusCode,
    json: () =>
      Promise.resolve({
        success: true,
        statusCode,
        data,
        timestamp: "2026-08-13T06:00:00.000Z",
        path: "/api/v1/trips",
      }),
  } as unknown as Response;
}

function errorEnvelope(
  code: string,
  message: string,
  statusCode: number,
  details?: unknown,
) {
  return {
    ok: false,
    status: statusCode,
    json: () =>
      Promise.resolve({
        success: false,
        statusCode,
        error: { code, message, details },
        timestamp: "2026-08-13T06:00:00.000Z",
        path: "/api/v1/trips",
      }),
  } as unknown as Response;
}

describe("request", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe("successful calls", () => {
    it("returns the envelope's data, not the envelope", async () => {
      fetchMock.mockResolvedValue(successEnvelope({ id: "trip-1" }));

      await expect(request("/api/v1/trips/trip-1")).resolves.toEqual({
        id: "trip-1",
      });
    });

    it("returns null when the backend legitimately sends null", async () => {
      // An unpriced Trip: an ordinary state the backend reports as null data.
      fetchMock.mockResolvedValue(successEnvelope(null));

      await expect(request("/api/v1/trip-pricing/trip/x")).resolves.toBeNull();
    });

    it("calls the configured backend, never a hardcoded host", async () => {
      fetchMock.mockResolvedValue(successEnvelope([]));

      await request("/api/v1/trips");

      expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/v1/trips`);
    });

    it("defaults to GET without a body", async () => {
      fetchMock.mockResolvedValue(successEnvelope([]));

      await request("/api/v1/trips");

      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        method: "GET",
        body: undefined,
      });
    });

    it("sends a JSON body and content type when one is supplied", async () => {
      fetchMock.mockResolvedValue(successEnvelope({}));

      await request("/api/v1/trips", { method: "POST", body: { a: 1 } });

      const [, init] = fetchMock.mock.calls[0];

      expect(init.method).toBe("POST");
      expect(init.body).toBe('{"a":1}');
      expect(init.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("query strings", () => {
    it("appends the supplied parameters", async () => {
      fetchMock.mockResolvedValue(successEnvelope([]));

      await request("/api/v1/trips", { query: { page: 2, pageSize: 25 } });

      expect(fetchMock.mock.calls[0][0]).toBe(
        `${BASE_URL}/api/v1/trips?page=2&pageSize=25`,
      );
    });

    /** An absent filter must not become `status=undefined`. */
    it("drops undefined, null and empty values", async () => {
      fetchMock.mockResolvedValue(successEnvelope([]));

      await request("/api/v1/trips", {
        query: { page: 1, status: undefined, search: "", driverId: null },
      });

      expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/v1/trips?page=1`);
    });

    it("encodes values that need it", async () => {
      fetchMock.mockResolvedValue(successEnvelope([]));

      await request("/api/v1/trips", { query: { search: "a b&c" } });

      expect(fetchMock.mock.calls[0][0]).toContain("search=a+b%26c");
    });
  });

  describe("errors from the backend", () => {
    it("throws an ApiError carrying the backend's code and message", async () => {
      fetchMock.mockResolvedValue(
        errorEnvelope("NOT_FOUND", "No Trip with that id.", 404),
      );

      const error = await request("/api/v1/trips/x").catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("NOT_FOUND");
      expect((error as ApiError).message).toBe("No Trip with that id.");
      expect((error as ApiError).statusCode).toBe(404);
    });

    it("marks a 404 as not-found so a page can treat it as a state", async () => {
      fetchMock.mockResolvedValue(errorEnvelope("NOT_FOUND", "Gone.", 404));

      const error = await catchApiError(request("/api/v1/trips/x"));

      expect(error.isNotFound).toBe(true);
    });

    it("does not mark other failures as not-found", async () => {
      fetchMock.mockResolvedValue(
        errorEnvelope("CONFLICT", "Trip is OPEN.", 409),
      );

      const error = await catchApiError(request("/api/v1/x"));

      expect(error.isNotFound).toBe(false);
    });

    it("keeps field-level validation details", async () => {
      fetchMock.mockResolvedValue(
        errorEnvelope("VALIDATION_ERROR", "Invalid request.", 400, [
          "page must be a positive number",
        ]),
      );

      const error = await catchApiError(request("/api/v1/trips"));

      expect(error.details).toEqual(["page must be a positive number"]);
    });
  });

  describe("failures that are not the backend's envelope", () => {
    it("reports an unreachable server in words a user can act on", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

      const error = await catchApiError(request("/api/v1/trips"));

      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe("NETWORK_ERROR");
      expect(error.message).toMatch(/could not be reached/i);
    });

    it("reports a response that is not JSON", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      } as unknown as Response);

      const error = await catchApiError(request("/api/v1/trips"));

      expect(error.code).toBe("MALFORMED_RESPONSE");
    });

    /** A proxy returning its own JSON must not be read as a success. */
    it("reports JSON that is not the envelope", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ anything: "else" }),
      } as unknown as Response);

      const error = await catchApiError(request("/api/v1/trips"));

      expect(error.code).toBe("MALFORMED_RESPONSE");
    });

    /** An abort is the caller cancelling; it must not become a user-facing error. */
    it("rethrows an abort untouched", async () => {
      const abort = new Error("The operation was aborted.");
      abort.name = "AbortError";
      fetchMock.mockRejectedValue(abort);

      const error = await request("/api/v1/trips").catch(
        (caught: unknown) => caught,
      );

      expect(error).toBe(abort);
      expect(error).not.toBeInstanceOf(ApiError);
    });
  });
});

describe("userFacingMessage", () => {
  it("uses the backend's message, which is written for people", () => {
    const error = new ApiError("CONFLICT", "Trip is OPEN, so it cannot be priced.", 409);

    expect(userFacingMessage(error)).toBe(
      "Trip is OPEN, so it cannot be priced.",
    );
  });

  /**
   * A bug in this application must not put its own message on screen: it could
   * name internals and tells the user nothing they can do.
   */
  it("hides anything that is not an API error behind a neutral sentence", () => {
    const message = userFacingMessage(
      new TypeError("Cannot read properties of undefined (reading 'items')"),
    );

    expect(message).toBe(
      "Something went wrong while loading this page. Please try again.",
    );
    expect(message).not.toMatch(/undefined/);
  });

  it("never exposes a stack trace", () => {
    const internal = new Error("boom");

    expect(userFacingMessage(internal)).not.toContain("at ");
  });
});
