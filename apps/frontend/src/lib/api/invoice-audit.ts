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
  /** A correction would make it a transport another line already is. */
  | "CONFLICT"
  /** A Cost Confirmation line, resolved through its `EC <nr>`. */
  | "COST_LINE"
  | "COST_LINE_UNRESOLVED"
  /** A line this check wrote into the document itself. Priced, never settled. */
  | "ADDED_MISSING";

/** What the pricing check concluded about a line. */
export type InvoicePricingStatus =
  | "MATCHED_NO_CHANGES"
  /** At least one amount is raised to this system's figure. */
  | "PRICING_CORRECTED"
  /** Nothing raised; the invoice states MORE than this system. Never lowered. */
  | "INVOICE_HIGHER"
  | "NOT_COMPARED"
  | "NOT_DISTRIBUTABLE"
  /** The Trip's stored price cannot be relied on; nothing is written. */
  | "PRICE_UNRELIABLE"
  /** An amount cell holds something that is not an amount. */
  | "AMOUNT_UNREADABLE"
  /** The Excel's Combination cannot be confirmed; nothing is written. */
  | "COMBINATION_REVIEW";

/** What one difference is, decided by the backend. */
export type InvoiceDifferenceKind =
  | "RAISE"
  | "REMOVE"
  | "KEEP_AMOUNT"
  | "INVOICE_HIGHER"
  | "NOT_PLACEABLE"
  | "UNREADABLE";

/** Why a Trip's stored price could not be relied on. */
export type InvoicePriceProblem =
  | "NO_SNAPSHOT"
  | "METADATA_MISSING"
  | "ROUTE_NOT_FOUND"
  | "ROUTE_AMBIGUOUS"
  | "COMBINATION_NOT_PRICED"
  | "MANUAL_ROUTE_REMOVED"
  | "SNAPSHOT_INCONSISTENT";

/** How the system matched a route, as the stored price recorded it. */
export type RouteMatchMethod = "EXACT" | "NORMALIZED" | "FUZZY" | "NOT_FOUND" | "AMBIGUOUS";

/**
 * The Trip's own road beside the road its stored price was made on, and how the
 * system matched them — information, never the reason a price is doubted.
 */
export interface InvoiceRouteDescription {
  readonly matchMethod: RouteMatchMethod | null;
  readonly tripRoute: string | null;
  readonly pricedRoute: string | null;
}

export interface InvoicePriceReliability {
  readonly reliable: boolean;
  readonly problem: InvoicePriceProblem | null;
  readonly explanation: string | null;
  readonly route: InvoiceRouteDescription | null;
}

/**
 * One component of one line: what the invoice charges, what this system holds,
 * and what the corrected document will say.
 *
 * Amounts are STRINGS at the money precision, as every pricing figure in this
 * application is — they are displayed and compared, never calculated with.
 */
/** What became of one component: unchanged, or the kind of its difference. */
export type InvoiceComparisonOutcome = "UNCHANGED" | InvoiceDifferenceKind;

export interface InvoicePriceComparison {
  readonly component: string;
  readonly outcome: InvoiceComparisonOutcome;
  /** What the Excel states; 0.00 for an empty cell; null only when unreadable. */
  readonly excelValue: string | null;
  /** The cell is empty: its 0.00 is what it was compared as, not a written figure. */
  readonly excelCellEmpty: boolean;
  /** What Trano holds; null when there is nothing to set against the cell. */
  readonly tranoValue: string | null;
  /** What the corrected document writes; null when nothing is written. */
  readonly writtenValue: string | null;
}

export interface InvoicePricingDifference {
  readonly component: string;
  readonly kind: InvoiceDifferenceKind;
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

/**
 * The invoice named the right transport with the wrong container.
 *
 * Decided by the backend: set only on a MATCHED line found by its date and
 * booking because its container matched no Trip. The screen shows it; it never
 * compares containers itself.
 */
export interface InvoiceContainerCorrection {
  /** As the sheet spelled it — the value that was wrong. */
  readonly invoiceContainerNumber: string;
  /** What the corrected workbook writes in its place, in red. */
  readonly tripContainerNumber: string;
}

export interface InvoiceAuditRow {
  /** The row's number in the worksheet, which is where a correction would go. */
  readonly rowNumber: number;
  readonly status: InvoiceRowStatus;
  readonly planningDate: string;
  readonly bookingNumber: string;
  /**
   * `Quay 869 → ZEMST`: the route of the Trip the line is matched to as a
   * transport, from the backend. Null without a transport match.
   */
  readonly route: string | null;
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
  /**
   * Every compared component, Excel beside Trano, in the invoice's column
   * order — the check's own comparison. Empty when the line was not compared.
   */
  readonly comparisons: readonly InvoicePriceComparison[];
  /** The line states no transport price: compared as €0, Trano's are filled in. */
  readonly transportPricesFilled: boolean;
  /** Null for a line that was not compared. */
  readonly priceReliability: InvoicePriceReliability | null;
  /** Null unless the invoice's container was wrong and is corrected. */
  readonly containerCorrection: InvoiceContainerCorrection | null;
  /** Null unless the invoice's booking number was wrong and is corrected. */
  readonly bookingCorrection: InvoiceBookingCorrection | null;
  /** Null unless the invoice's date was wrong and is corrected. */
  readonly dateCorrection: InvoiceDateCorrection | null;
  /** The confirmation a Cost Confirmation line charges. */
  readonly costConfirmation: InvoiceCostConfirmation | null;
  /** Set on a line the Excel marks as half of a Combination. */
  readonly combination: InvoiceCombination | null;
  /**
   * Why the line could not be resolved — for a line that found no Trip or
   * several, which pairs of values were tried or which Trips it could be.
   */
  readonly matchProblem: string | null;
  /** What this check adds to the line's Remarks; null when nothing. */
  readonly remarks: InvoiceRemarks | null;
}

export interface InvoiceDateCorrection {
  readonly invoicePlanningDate: string;
  /** The Trip's own planning date, written in red in the corrected workbook. */
  readonly tripPlanningDate: string;
}


export interface InvoiceRemarks {
  readonly before: string;
  readonly after: string;
  readonly added: readonly string[];
  /** A waiting time with no customer spelling, a word the invoice does not use yet. */
  readonly notes: readonly string[];
}

export interface InvoiceBookingCorrection {
  readonly invoiceBookingNumber: string;
  readonly tripBookingNumber: string;
}

export interface InvoiceCostConfirmation {
  /** Digits only; the sheet prints `EC <nr>`. */
  readonly ccNumber: string;
  readonly amount: string;
}

export interface InvoiceCombination {
  readonly verdict: "RECOGNISED" | "GEEN_COMBI" | "REVIEW";
  readonly partnerRowNumber: number | null;
  readonly reason: string | null;
}

/** A transport not added because an unresolved line could be it. */
export interface BlockedMissingTrip {
  readonly tripId: string;
  readonly planningDate: string;
  readonly bookingNumber: string | null;
  readonly containerNumber: string | null;
  readonly blockingRowNumbers: readonly number[];
}

/**
 * A finished transport the invoice never mentioned.
 *
 * Not a problem line: this system finished it, nobody has paid for it, and the
 * corrected workbook adds it as an ordinary line on `rowNumber` — without
 * amounts, and yellow, when its stored price cannot be relied on.
 */
export interface MissingTrip {
  readonly tripId: string;
  readonly planningDate: string;
  readonly bookingNumber: string | null;
  readonly containerNumber: string | null;
  readonly route: string;
  readonly tarief: string | null;
  readonly totaal: string | null;
  readonly priceReliability: InvoicePriceReliability;
  /** The Remarks the added line gets, in the customer's words; empty for none. */
  readonly remarks: string;
  readonly remarkNotes: readonly string[];
  /** The end that carries `COMBINATION`, for a leg of a group of two. */
  readonly combinationEnd: "startPoint" | "endPoint" | null;
  /** The row the corrected workbook writes it on; null when it cannot be added. */
  readonly rowNumber: number | null;
}

/** Whether the document's totals can take added lines; when not, why not. */
export interface InvoiceTotalsStructure {
  readonly sound: boolean;
  readonly problems: readonly string[];
}

export interface InvoiceTextChange {
  readonly address: string;
  readonly before: string;
  readonly after: string;
}

/** The Fuel header and label, when the whole column states one new percentage. */
export interface InvoiceFuelHeaderChange {
  readonly percentage: string;
  readonly header: InvoiceTextChange;
  readonly label: InvoiceTextChange | null;
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
  readonly priceInvoiceHigher: number;
  readonly priceNotDistributable: number;
  readonly priceUnreliable: number;
  readonly amountUnreadable: number;
  /** Cells the corrected workbook would write. */
  readonly correctedCells: number;
  /** Finished, unpaid transports of this period the invoice does not state. */
  readonly missingTrips: number;
  /** Lines a previous run wrote into this document. Never settled. */
  readonly addedMissing: number;
  /** Matched lines whose container was wrong. Counted within `matched` too. */
  readonly containerCorrected: number;
  readonly blockedMissingTrips: number;
  readonly bookingCorrected: number;
  readonly dateCorrected: number;
  readonly conflicts: number;
  readonly costLines: number;
  readonly costLinesUnresolved: number;
  readonly combinationsRecognised: number;
  readonly geenCombi: number;
  readonly combinationsReview: number;
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
  readonly blockedMissingTrips: readonly BlockedMissingTrip[];
  readonly totalsStructure: InvoiceTotalsStructure;
  /** Null when the Fuel header stays as the customer wrote it. */
  readonly fuelHeader: InvoiceFuelHeaderChange | null;
  /** The rows the corrected document marks yellow — decided by the backend. */
  readonly markedRowNumbers: readonly number[];
  readonly totals: InvoiceTotals;
  /** Every transport the invoice charges, and whether a confirmation may settle it. */
  readonly payments: readonly InvoiceTripPayment[];
}

/** The invoice's amounts, added up over its lines, before and after the correction. */
export interface InvoiceTotals {
  readonly columns: readonly {
    readonly column: string;
    readonly before: string;
    readonly after: string;
  }[];
  readonly before: string;
  readonly after: string;
}

/** `ADDED`: not on the customer's invoice, added to the corrected one with a reliable price. */
export type InvoicePaymentCategory = "UNCHANGED" | "RAISED" | "INVOICE_HIGHER" | "ADDED";

export type InvoiceNotPayableReason =
  | "NOT_CLOSED"
  | "NO_OWN_LINE"
  | "NOT_ADDED"
  | "LINE_MARKED"
  | "PRICE_NOT_SETTLED"
  | "AMBIGUOUS_MATCH"
  | "MATCH_CONFLICT"
  | "BLOCKED_BY_UNRESOLVED_LINE";

/** One transport the invoice charges — decided by the backend, shown here. */
export interface InvoiceTripPayment {
  readonly tripId: string;
  readonly planningDate: string | null;
  readonly bookingNumber: string | null;
  readonly containerNumber: string | null;
  readonly rowNumbers: readonly number[];
  readonly payable: boolean;
  /** Null when not payable. */
  readonly category: InvoicePaymentCategory | null;
  readonly reasons: readonly InvoiceNotPayableReason[];
  /** The rows to fix for it to become payable; empty when none. */
  readonly blockingRowNumbers: readonly number[];
  /** Re-invoiced: already paid, never paid again. */
  readonly alreadyPaid: boolean;
}

/** What a payment confirmation did. */
export interface InvoicePaymentResult {
  readonly paidTrips: number;
  readonly alreadyPaid: number;
  readonly paidTripIds: readonly string[];
}

/** The corrected document, and what was written into it. Nothing is paid. */
export interface AppliedInvoiceAudit {
  /** The corrected workbook, ready to be saved. */
  readonly file: Blob;
  /** The name the browser should save it under. */
  readonly fileName: string;
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
 * Produces the corrected weekly invoice. Nothing in the system changes: in
 * particular, nothing is paid — that is `confirmInvoicePayment`.
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
      "De server is niet bereikbaar. Controleer of de backend draait en probeer het opnieuw.",
      0,
    );
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  return {
    file: await response.blob(),
    fileName: toFileName(response, file.name),
    rowsAdded: toCount(response, "X-Invoice-Rows-Added"),
    rowsMarked: toCount(response, "X-Invoice-Rows-Marked"),
    correctedCells: toCount(response, "X-Invoice-Cells-Corrected"),
  };
}

/**
 * Confirms the payment of the chosen transports.
 *
 * The ORIGINAL file goes up again with the chosen Trip ids: the backend
 * examines the document afresh and pays only what is payable on it now. If a
 * single chosen Trip is not, it refuses the whole request and pays nothing.
 */
export function confirmInvoicePayment(
  file: File,
  tripIds: readonly string[],
  signal?: AbortSignal,
): Promise<InvoicePaymentResult> {
  const body = new FormData();

  body.append("file", file);
  body.append("tripIds", JSON.stringify(tripIds));

  return request<InvoicePaymentResult>("/api/v1/invoice-audit/payment", {
    method: "POST",
    body,
    signal,
  });
}

/** The backend's own reason, when it sent one. */
async function toApiError(response: Response): Promise<ApiError> {
  try {
    const payload: unknown = await response.json();
    const error = (
      payload as { error?: { code?: string; message?: string; details?: unknown } }
    ).error;

    if (error?.message) {
      return new ApiError(
        error.code ?? "UNKNOWN",
        error.message,
        response.status,
        error.details,
      );
    }
  } catch {
    // Not the envelope — fall through to the generic message below.
  }

  return new ApiError(
    "UNKNOWN",
    "Er ging iets mis bij het verwerken van deze factuur. Probeer het opnieuw.",
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
