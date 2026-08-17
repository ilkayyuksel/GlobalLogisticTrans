import { request } from "./client";
import type {
  ImportedEmail,
  ImportedEmailStatus,
  ImportType,
  Paginated,
  Trip,
} from "./types";

/**
 * How transport orders enter the system: by mail, and by hand.
 *
 * The mailbox side is read-only — those rows are evidence of what actually
 * happened, and the backend exposes no way to edit or remove them; a failed
 * import is retried by the next scan, not corrected here.
 *
 * The manual side sends files and nothing else. The PDF is read, parsed and
 * turned into Trips entirely by the backend: this application never opens one.
 */

export interface ListImportedEmailsParams {
  page?: number;
  pageSize?: number;
  processingStatus?: ImportedEmailStatus;
  importType?: ImportType;
}

/**
 * What one uploaded file produced.
 *
 * `ok` discriminates: a successful file carries the Trips it created and
 * whether they were a Combination, a refused one carries the backend's reason.
 * `code` is for matching, never for display — `message` is the text written for
 * an operator.
 */
/** What became of one booking a cancelled document named. */
export interface CancelledBooking {
  bookingNumber: string;
  outcome:
    | "CANCELLED"
    | "ALREADY_CANCELLED"
    | "REFUSED_CLOSED"
    | "NO_MATCHING_TRIP";
}

export interface PdfImportFileResult {
  filename: string;
  ok: boolean;
  trips?: Trip[];
  combination?: boolean;
  /**
   * Present when the document stamped itself CANCELLED. Such a file is handled
   * rather than imported: it cancels the Trips it names and creates none, so
   * `trips` is empty.
   */
  cancellations?: CancelledBooking[];
  code?: string;
  message?: string;
}

export interface PdfImportResult {
  results: PdfImportFileResult[];
}

/**
 * Uploads transport-order PDFs and returns what each one produced.
 *
 * The whole batch travels in one request, under the field name the endpoint
 * documents. The request succeeds even when individual files are refused —
 * their failure is a result, not an exception — so a rejected promise here
 * means the upload itself failed: no connection, too large, or no files.
 */
export function uploadTransportOrderPdfs(
  files: readonly File[],
  signal?: AbortSignal,
): Promise<PdfImportResult> {
  const body = new FormData();

  for (const file of files) {
    body.append("files", file);
  }

  return request<PdfImportResult>("/api/v1/pdf-import", {
    method: "POST",
    body,
    signal,
  });
}

export function listImportedEmails(
  params: ListImportedEmailsParams = {},
  signal?: AbortSignal,
): Promise<Paginated<ImportedEmail>> {
  return request<Paginated<ImportedEmail>>("/api/v1/imported-emails", {
    query: {
      page: params.page,
      pageSize: params.pageSize,
      processingStatus: params.processingStatus,
      importType: params.importType,
    },
    signal,
  });
}
