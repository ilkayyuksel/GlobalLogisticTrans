import { getAccessToken } from "@/lib/auth/access-token";
import { ApiError, apiBaseUrl } from "./client";

/**
 * The stored transport order behind a Trip.
 *
 * Fetched as bytes rather than through `request`, which exists to unwrap the
 * JSON envelope — a PDF has no envelope. The failure path still speaks the same
 * language: the backend reports a missing document or a missing file as the
 * usual error envelope, so that is parsed here and raised as the same `ApiError`
 * every other call throws.
 *
 * The URL is built from the configured API base only. The frontend never learns
 * where the file lives, and there is nothing filesystem-like in it to build.
 */
export async function fetchPdfDocument(
  pdfDocumentId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const url = `${apiBaseUrl()}/api/v1/pdf-documents/${pdfDocumentId}/content`;

  let response: Response;

  try {
    /*
     * The same Authorization header every other call carries. This endpoint is
     * protected exactly like the rest of the API, and it is reached with a bare
     * `fetch` only because it returns bytes rather than the JSON envelope.
     */
    const token = await getAccessToken();

    response = await fetch(url, {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    throw new ApiError(
      "NETWORK_ERROR",
      "The server could not be reached. Check that the backend is running, then try again.",
      0,
    );
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  return response.blob();
}

/**
 * The backend's own reason, when it sent one.
 *
 * A failing content request answers with the standard error envelope, so the
 * message an operator sees for a missing PDF is the same one they would see
 * anywhere else in the application.
 */
async function toApiError(response: Response): Promise<ApiError> {
  try {
    const payload: unknown = await response.json();
    const error = (payload as { error?: { code?: string; message?: string } })
      .error;

    if (error?.message) {
      return new ApiError(
        error.code ?? "UNKNOWN",
        error.message,
        response.status,
      );
    }
  } catch {
    // Not the envelope — fall through to the generic message below.
  }

  return new ApiError(
    "UNKNOWN",
    "The transport order could not be loaded.",
    response.status,
  );
}
