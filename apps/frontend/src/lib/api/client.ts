import { getAccessToken } from "@/lib/auth/access-token";
import type { ApiErrorDetail, ApiResponse } from "./types";

/**
 * The only place this application talks to the backend.
 *
 * Every call goes through `request`, so the envelope is unwrapped once, errors
 * become one exception type once, and the base URL is read from configuration
 * once. Components call the typed functions in the sibling modules and never
 * see `fetch`, a status code or an envelope.
 */

/** Raised for every unsuccessful call, whatever the cause. */
export class ApiError extends Error {
  constructor(
    /** Stable identifier from the backend, e.g. "NOT_FOUND". */
    readonly code: string,
    message: string,
    readonly statusCode: number,
    /** Field-level validation failures, when the backend supplied them. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /**
   * Whether this is the backend saying "no such thing".
   *
   * Distinguished because a missing record is often a page state — "this Trip
   * does not exist" — rather than a failure to report as an error.
   */
  get isNotFound(): boolean {
    return this.statusCode === 404;
  }
}

/** Used when the backend could not be reached or spoke unexpectedly. */
const NETWORK_ERROR_CODE = "NETWORK_ERROR";
const MALFORMED_RESPONSE_CODE = "MALFORMED_RESPONSE";

/**
 * A failure the user can act on, for the cases where no backend message exists.
 *
 * The backend's own message is always preferred — it is written for this
 * system and is more specific than anything generic here.
 */
const NETWORK_ERROR_MESSAGE =
  "The server could not be reached. Check that the backend is running, then try again.";

/**
 * Where the backend lives.
 *
 * Read from the environment, never hardcoded. Next inlines `NEXT_PUBLIC_*` at
 * build time, so this must be referenced as a full property access rather than
 * destructured from `process.env`.
 */
export function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;

  if (!configured) {
    throw new ApiError(
      "MISSING_CONFIGURATION",
      "NEXT_PUBLIC_API_URL is not set, so the application does not know where the backend is.",
      0,
    );
  }

  // A trailing slash would produce "//api/v1" when joined with a path.
  return configured.replace(/\/+$/, "");
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /**
   * Serialised as JSON, unless it is FormData — a file upload is sent as the
   * multipart body it already is. Omitted entirely for GET.
   */
  body?: unknown;
  /** Appended as a query string; undefined and null values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

/**
 * Performs one backend call and returns the unwrapped `data`.
 *
 * Errors are never returned — they are thrown as `ApiError`, so a caller that
 * gets a value knows it succeeded and a caller that wants to handle failure
 * does so in one place.
 */
export async function request<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<TData> {
  const url = buildUrl(path, options.query);
  const method = options.method ?? "GET";

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: await requestHeaders(options.body),
      body: requestBody(options.body),
      signal: options.signal,
    });
  } catch (error: unknown) {
    // An aborted request is the caller changing its mind — usually a component
    // unmounting — and must not be reported to the user as a failure.
    if (isAbortError(error)) {
      throw error;
    }

    throw new ApiError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, 0);
  }

  return unwrap<TData>(response);
}

function isMultipart(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

/**
 * A multipart body is deliberately sent without a Content-Type.
 *
 * The header has to carry the boundary that separates the parts, and only the
 * browser knows it. Setting "multipart/form-data" by hand omits the boundary
 * and the server cannot then read a single file.
 *
 * The Authorization header is added here, in the one place every call passes
 * through, rather than at each call site — the backend requires a valid Auth0
 * access token on every business endpoint, and a caller that forgot would get a
 * 401 that looks like a permissions problem.
 *
 * A missing token is not an error here. Nobody is signed in, the header is
 * omitted, and the backend answers 401 — which is the correct outcome rather
 * than something this layer should pre-empt with a message of its own.
 */
async function requestHeaders(body: unknown): Promise<HeadersInit> {
  const headers: Record<string, string> = { Accept: "application/json" };

  if (body !== undefined && !isMultipart(body)) {
    headers["Content-Type"] = "application/json";
  }

  const token = await getAccessToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function requestBody(body: unknown): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  return isMultipart(body) ? body : JSON.stringify(body);
}

/**
 * Turns a response into data, or into an ApiError.
 *
 * The backend wraps everything in a success or error envelope, so that is what
 * is trusted here rather than the status code alone. A response that is not the
 * envelope at all — an HTML error page from a proxy, say — is reported as a
 * malformed response instead of crashing on a missing property.
 */
async function unwrap<TData>(response: Response): Promise<TData> {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      MALFORMED_RESPONSE_CODE,
      "The server returned a response this application could not read.",
      response.status,
    );
  }

  if (!isEnvelope(payload)) {
    throw new ApiError(
      MALFORMED_RESPONSE_CODE,
      "The server returned a response this application could not read.",
      response.status,
    );
  }

  if (payload.success) {
    return payload.data as TData;
  }

  const error: ApiErrorDetail = payload.error;

  throw new ApiError(
    error.code,
    error.message,
    payload.statusCode ?? response.status,
    error.details,
  );
}

function buildUrl(
  path: string,
  query: RequestOptions["query"],
): string {
  const url = new URL(`${apiBaseUrl()}${path}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function isEnvelope(payload: unknown): payload is ApiResponse<unknown> {
  if (payload === null || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<ApiResponse<unknown>>;

  if (candidate.success === true) {
    return "data" in candidate;
  }

  return (
    candidate.success === false &&
    typeof (candidate as { error?: unknown }).error === "object" &&
    (candidate as { error: ApiErrorDetail }).error !== null
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * A message safe to put in front of a user.
 *
 * The backend already writes messages for people rather than for developers, so
 * its text is used as-is. Anything that is not an ApiError — a bug in this
 * application — is deliberately NOT surfaced: its message could name internals,
 * and it would tell the user nothing they can act on.
 */
export function userFacingMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "Something went wrong while loading this page. Please try again.";
}
