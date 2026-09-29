import { ApiError, apiBaseUrl, request } from "./client";
import { getAccessToken } from "@/lib/auth/access-token";

/**
 * The weekly invoice check.
 *
 * ── THE BROWSER NEVER READS THE WORKBOOK ────────────────────────────────────
 * The file is sent as it is and every decision — which row is a line, which
 * Trip it is about, whether that Trip is finished — is the backend's. A reader
 * here would be a second implementation of the one thing that must agree with
 * the document that gets corrected later.
 */

export type InvoiceRowStatus =
  | "MATCHED"
  | "NOT_FOUND"
  | "NOT_FINISHED"
  | "AMBIGUOUS"
  /** A line this check wrote into the document itself. Priced, never settled. */
  | "ADDED_MISSING";

/** What the pricing check concluded about a line. */
export type InvoicePricingStatus =
  | "MATCHED_NO_CHANGES"
  | "PRICING_CORRECTED"
  | "NOT_COMPARED"
  | "NOT_DISTRIBUTABLE";

/**
 * One component of one line: what the invoice charges, what this system holds,
 * and what the corrected document will say.
 *
 * Amounts are STRINGS at the money precision, as every pricing figure in this
 * application is — they are displayed and compared, never calculated with.
 */
export interface InvoicePricingDifference {
  readonly component: string;
  readonly column: string | null;
  readonly invoiceValue: string | null;
  readonly expectedValue: string;
  readonly difference: string;
  readonly correctedValue: string | null;
  readonly correctionRowNumber: number | null;
  readonly keepsFormula: boolean;
  readonly problem: string | null;
}

/** What this system holds for the Trip a line was matched to. */
export interface InvoiceAuditTrip {
  readonly id: string;
  readonly status: string;
  readonly planningDate: string | null;
  readonly bookingNumber: string | null;
  readonly containerNumber: string | null;
}

export interface InvoiceAuditRow {
  /** The row's number in the worksheet, which is where a correction would go. */
  readonly rowNumber: number;
  readonly status: InvoiceRowStatus;
  readonly planningDate: string;
  readonly bookingNumber: string;
  /** As the sheet spells it. */
  readonly containerNumber: string;
  /** The same container, as the match compared it. */
  readonly normalizedContainerNumber: string;
  readonly trip: InvoiceAuditTrip | null;
  readonly candidates: readonly InvoiceAuditTrip[];
  /** Other rows of the same document stating the same three values. */
  readonly sharedKeyRowNumbers: readonly number[];
  readonly pricingStatus: InvoicePricingStatus;
  readonly differences: readonly InvoicePricingDifference[];
}

/**
 * A finished transport the invoice never mentioned.
 *
 * Not a problem line: this system finished it, nobody has paid for it, and the
 * corrected workbook adds it as an ordinary line on `rowNumber`.
 */
export interface MissingTrip {
  readonly tripId: string;
  readonly planningDate: string;
  readonly bookingNumber: string | null;
  readonly containerNumber: string | null;
  readonly route: string;
  readonly tarief: string | null;
  readonly totaal: string | null;
  /** The row the corrected workbook writes it on. */
  readonly rowNumber: number;
}

export interface InvoiceAuditSummary {
  readonly totalRows: number;
  readonly matched: number;
  readonly notFound: number;
  readonly notFinished: number;
  readonly ambiguous: number;
  /** Matched lines whose pricing was compared. */
  readonly priceChecked: number;
  readonly priceUnchanged: number;
  readonly priceCorrected: number;
  readonly priceNotDistributable: number;
  /** Cells the corrected workbook would write. */
  readonly correctedCells: number;
  /** Finished, unpaid transports of this period the invoice does not state. */
  readonly missingTrips: number;
  /** Lines a previous run wrote into this document. Never settled. */
  readonly addedMissing: number;
}

export interface InvoiceAuditResult {
  readonly fileName: string;
  readonly sheetName: string;
  /** Derived from the Planning date values, never from the file name. */
  readonly period: { readonly from: string; readonly to: string } | null;
  readonly summary: InvoiceAuditSummary;
  readonly rows: readonly InvoiceAuditRow[];
  readonly incompleteRowNumbers: readonly number[];
  readonly missingTrips: readonly MissingTrip[];
}

/** What the final processing did, beside the file it produced. */
export interface AppliedInvoiceAudit {
  /** The corrected workbook, ready to be saved. */
  readonly file: Blob;
  /** The name the browser should save it under. */
  readonly fileName: string;
  /** Trips this run marked paid. */
  readonly paidTrips: number;
  /** Trips that were already paid before it ran. */
  readonly alreadyPaid: number;
  readonly rowsAdded: number;
  readonly rowsMarked: number;
  readonly correctedCells: number;
}

/**
 * Checks one weekly invoice.
 *
 * Nothing is written by this call: no price is corrected, no Trip is marked
 * paid, and the file is neither stored nor changed. A rejected promise means
 * the document was refused — the message says why, and names the columns when
 * the structure is the problem.
 */
export function checkInvoiceWorkbook(
  file: File,
  signal?: AbortSignal,
): Promise<InvoiceAuditResult> {
  const body = new FormData();

  body.append("file", file);

  return request<InvoiceAuditResult>("/api/v1/invoice-audit/check", {
    method: "POST",
    body,
    signal,
  });
}

/**
 * Processes one weekly invoice, finally.
 *
 * ── ONE REQUEST, AND THE BACKEND ORDERS THE WORK ────────────────────────────
 * The corrected document and the payments it settles come from a single call:
 * the server produces the whole file first and only then marks the transports
 * paid, so a document it could not write settles nothing. A browser that
 * corrected the file and then fired a hundred payment requests could not make
 * that promise.
 *
 * Reached with a bare `fetch` because the answer is BYTES rather than the JSON
 * envelope — the same reason `fetchPdfDocument` does. A refusal still speaks
 * the envelope, and is raised as the `ApiError` every other call throws.
 */
export async function applyInvoiceAudit(
  file: File,
  signal?: AbortSignal,
): Promise<AppliedInvoiceAudit> {
  const body = new FormData();

  body.append("file", file);

  let response: Response;

  try {
    const token = await getAccessToken();

    response = await fetch(`${apiBaseUrl()}/api/v1/invoice-audit/apply`, {
      method: "POST",
      body,
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

  return {
    file: await response.blob(),
    fileName: toFileName(response, file.name),
    paidTrips: toCount(response, "X-Invoice-Paid-Trips"),
    alreadyPaid: toCount(response, "X-Invoice-Already-Paid"),
    rowsAdded: toCount(response, "X-Invoice-Rows-Added"),
    rowsMarked: toCount(response, "X-Invoice-Rows-Marked"),
    correctedCells: toCount(response, "X-Invoice-Cells-Corrected"),
  };
}

/** The backend's own reason, when it sent one. */
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
    "Something went wrong while processing this invoice. Please try again.",
    response.status,
  );
}

/**
 * The name the server gave the file, or a sensible one built from the upload.
 *
 * The header is read when the browser is allowed to see it; a cross-origin
 * response only exposes what the server lists, which this endpoint does.
 */
function toFileName(response: Response, uploadedName: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const quoted = /filename="([^"]+)"/.exec(disposition);

  if (quoted) {
    return quoted[1];
  }

  return uploadedName.toLowerCase().endsWith(".xlsx")
    ? `${uploadedName.slice(0, -".xlsx".length)} - gecorrigeerd.xlsx`
    : `${uploadedName} - gecorrigeerd.xlsx`;
}

/** A count the run reported, or zero when the header could not be read. */
function toCount(response: Response, header: string): number {
  const value = Number(response.headers.get(header));

  return Number.isFinite(value) ? value : 0;
}
