/**
 * The parser's public contract.
 *
 * A ParsedTrip is a statement of what the document says, nothing more. It
 * carries no price, no status, no identifiers from our database and no
 * decisions — the Backend validates these facts and decides what to do with
 * them.
 */

export type LayoutType =
  "SINGLE_ONE_PAGE" | "SINGLE_TWO_PAGE" | "COMBINATION_TWO_PAGE";

export type Direction = "COLLECTION" | "DELIVERY";

/**
 * What the document says about itself.
 *
 * PLANNED is an ordinary transport order. CANCELLED is one the sender has
 * stamped as cancelled, and the stamp is printed on the order itself — it is
 * not the same thing as a `CANCEL:` email, which is an instruction rather than
 * a document state. Both exist, and the Backend treats them as separate inputs.
 *
 * There is no UPDATE: no document carries a revision marker, so an update can
 * only ever be an email action.
 */
export type DocumentStatus = "PLANNED" | "CANCELLED";

/**
 * What the document actually said, kept beside the normalized value.
 *
 * Diagnostics are the whole purpose: when a city comes out wrong, the raw
 * address is what shows whether the parser or the document was at fault. Only
 * the handful of values that get normalized are kept — not the whole page,
 * which would bloat every stored Trip for no diagnostic gain.
 */
export interface ParsedTripRaw {
  readonly rawAddress: string | null;
  readonly rawTerminal: string | null;
  readonly rawDate: string | null;
  readonly rawBooking: string | null;
  /** Labels this trip was actually built from, in the order they were used. */
  readonly matchedLabels: string[];
  readonly sections: ParsedTripSections;
}

export interface ParsedTripSections {
  readonly page: number;
  /** The address section this trip was read from: `LOADING 1` or `DELIVERY 1`. */
  readonly addressSection: string | null;
  /** Section headers seen on the page, for diagnosing an unexpected document. */
  readonly detected: string[];
}

export interface ParsedTrip {
  readonly bookingNumber: string;
  readonly containerType: string;
  readonly containerNumber: string | null;
  /**
   * The terminal exactly as the document names it — `PSA Quay 869`,
   * `Quay 869`. Null when the document names none.
   *
   * Normalized, never renamed. This is NOT guaranteed to match a configured
   * route: translating a document's terminal into the operator's own naming is
   * an unresolved business decision, and it belongs to the Backend's import
   * layer, which is the only side that knows the configured names.
   */
  readonly terminal: string | null;
  readonly destinationCity: string;
  readonly destinationCountry: string | null;
  /** ISO calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  /** `HH:mm`, or null when the document states no time. */
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly direction: Direction;
  /**
   * Ties the two trips of a Combination together. Temporary parser metadata:
   * the Backend replaces it with a real Trip Group. Null for a single trip.
   */
  readonly groupKey: string | null;
  readonly raw: ParsedTripRaw;
}

export interface ParseMetadata {
  readonly pageCount: number;
  readonly fragmentCount: number;
  /** Section headers found across the document. */
  readonly detectedSections: string[];
}

export type ParseFailureReason =
  | "INVALID_PDF"
  | "UNREADABLE_PDF"
  | "UNSUPPORTED_LAYOUT"
  | "MISSING_REQUIRED_FIELD"
  | "INCONSISTENT_BOOKING_NUMBER"
  | "INVALID_DATE_TIME"
  | "MALFORMED_ADDRESS"
  | "UNSUPPORTED_COMBINATION";

export interface ParseSuccess {
  readonly ok: true;
  readonly layout: LayoutType;
  /**
   * What the document states about itself. A property of the DOCUMENT, not of
   * a trip: the stamp is printed on every page, so both legs of a Combination
   * share it.
   */
  readonly documentStatus: DocumentStatus;
  readonly parserVersion: string;
  readonly trips: ParsedTrip[];
  readonly metadata: ParseMetadata;
}

export interface ParseFailure {
  readonly ok: false;
  readonly reason: ParseFailureReason;
  /** Human-readable detail. Never a stack trace. */
  readonly message: string;
  readonly missingFields: string[];
  /** Labels that WERE found, so a diagnosis can start from what is present. */
  readonly detectedLabels: string[];
  readonly metadata: ParseMetadata;
}

export type ParseResult = ParseSuccess | ParseFailure;

/**
 * ── COST CONFIRMATION ───────────────────────────────────────────────────────
 * A different KIND of document, and deliberately a different result type.
 *
 * Eucon sends these after we report a waiting time: they confirm the money it
 * will pay for it. They arrive on the same form as a transport order and carry
 * a full copy of one, which is exactly why they get their own reader and their
 * own result — pushed through `parse()` they would look like an ordinary order
 * and create a second Trip for a booking that already exists.
 *
 * A Cost Confirmation NEVER creates a Trip. It names one.
 * ────────────────────────────────────────────────────────────────────────────
 */
export interface ParsedCostConfirmation {
  /** Eucon's number, digits only. `CC` is a display prefix, not data. */
  readonly ccNumber: string;
  /** The booking this confirmation belongs to. The only way it finds its Trip. */
  readonly bookingNumber: string;
  /** Fixed-2 decimal string, exactly as the document printed it. */
  readonly amount: string;
  readonly currency: string;
  /** `WAIT` on every document seen so far. Stored, never assumed. */
  readonly costCode: string;
  readonly costDescription: string | null;
  /** Null when the document prints an unreadable reference such as `????`. */
  readonly containerReference: string | null;
  readonly remarks: string | null;
  /** The confirmation block, kept as evidence for what was read. */
  readonly raw: string;
}

export interface CostConfirmationSuccess {
  readonly ok: true;
  readonly parserVersion: string;
  readonly confirmation: ParsedCostConfirmation;
  readonly metadata: ParseMetadata;
}

export type CostConfirmationFailureReason =
  | "INVALID_PDF"
  | "UNREADABLE_PDF"
  /** Readable, but no confirmation block: this is not a Cost Confirmation. */
  | "NOT_A_COST_CONFIRMATION"
  | "MISSING_REQUIRED_FIELD";

export interface CostConfirmationFailure {
  readonly ok: false;
  readonly reason: CostConfirmationFailureReason;
  readonly message: string;
  readonly missingFields: string[];
  readonly metadata: ParseMetadata;
}

export type CostConfirmationResult =
  | CostConfirmationSuccess
  | CostConfirmationFailure;
