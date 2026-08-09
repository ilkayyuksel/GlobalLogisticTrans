/**
 * The two shapes every HTTP response takes.
 *
 * A single, predictable envelope means the frontend needs exactly one response
 * handler instead of one per endpoint, and `success` can be checked without
 * inspecting the status code.
 */

interface ApiResponseBase {
  statusCode: number;
  timestamp: string;
  path: string;
}

/** Produced by ResponseInterceptor for every successful request. */
export interface ApiSuccessResponse<TData> extends ApiResponseBase {
  success: true;
  data: TData;
}

export interface ApiErrorDetail {
  /** Stable, machine-readable identifier, e.g. "NOT_FOUND". */
  code: string;
  message: string;
  /** Field-level validation failures, present only when relevant. */
  details?: unknown;
}

/** Produced by AllExceptionsFilter for every failed request. */
export interface ApiErrorResponse extends ApiResponseBase {
  success: false;
  error: ApiErrorDetail;
}
