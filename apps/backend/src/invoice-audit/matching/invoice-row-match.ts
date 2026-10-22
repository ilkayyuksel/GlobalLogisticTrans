import type { Trip } from "@prisma/client";

import type { InvoiceCostConfirmation } from "../invoice-audit-read.repository";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";

/**
 * What became of one invoice line.
 *
 * ── NEVER A GUESS ───────────────────────────────────────────────────────────
 * MATCHED is exactly one CLOSED Trip. AMBIGUOUS is more than one, and it stays
 * ambiguous: nothing is chosen. NOT_FINISHED is a Trip that is there but not
 * closed yet. NOT_FOUND is everything else.
 *
 * CONFLICT is a line that reaches its Trip only by a CORRECTION — of its date,
 * booking or container — while another line of the same document already names
 * that Trip: one transport cannot be two lines, so no correction is made and a
 * person decides.
 *
 * COST_LINE is a Cost Confirmation line resolved, through its `EC <nr>`, to the
 * confirmation and its Trip. COST_LINE_UNRESOLVED is one that could not be.
 *
 * ADDED_MISSING is a line this system wrote into the document itself; it is
 * priced and corrected like a matched line, and never settled.
 */
export const InvoiceRowStatus = {
  MATCHED: "MATCHED",
  NOT_FOUND: "NOT_FOUND",
  NOT_FINISHED: "NOT_FINISHED",
  AMBIGUOUS: "AMBIGUOUS",
  CONFLICT: "CONFLICT",
  COST_LINE: "COST_LINE",
  COST_LINE_UNRESOLVED: "COST_LINE_UNRESOLVED",
  ADDED_MISSING: "ADDED_MISSING",
} as const;

export type InvoiceRowStatus =
  (typeof InvoiceRowStatus)[keyof typeof InvoiceRowStatus];

/**
 * The invoice named the right transport with the wrong container.
 *
 * Present only on a line matched by booking and date ALONE, and only when the
 * Trip states a container of its own to correct it to.
 */
export interface ContainerCorrection {
  /** Exactly as the sheet spells it — the value that was wrong. */
  readonly invoiceContainerNumber: string;
  /** The Trip's own container, exactly as this system stores it. */
  readonly tripContainerNumber: string;
}

/**
 * The invoice named the right transport with the wrong booking number.
 *
 * Present only on a line no Trip shares its booking with on that day, whose
 * container on that day belongs to exactly ONE Trip — and only when no other
 * line of the document already names that Trip.
 */
export interface BookingCorrection {
  readonly invoiceBookingNumber: string;
  /** The Trip's own booking number, exactly as this system stores it. */
  readonly tripBookingNumber: string;
}

/**
 * The invoice named the right transport on the wrong day.
 *
 * Present only on a line whose booking AND container are exactly one Trip's,
 * on neither of that Trip's dates — and only when no other line of the
 * document already names that Trip.
 */
export interface DateCorrection {
  /** The day the line states, `YYYY-MM-DD`. */
  readonly invoicePlanningDate: string;
  /** The Trip's own `planningDate`, `YYYY-MM-DD`. */
  readonly tripPlanningDate: string;
}

/** What the Excel says about a line being half of a Combination. */
export const CombinationVerdict = {
  /** The Excel's pair is the system's own group of exactly these two Trips. */
  RECOGNISED: "RECOGNISED",
  /** Neither Trip belongs to any group: this is no Combination. */
  GEEN_COMBI: "GEEN_COMBI",
  /** The pair cannot be established reliably; a person decides. */
  REVIEW: "REVIEW",
} as const;

export type CombinationVerdict =
  (typeof CombinationVerdict)[keyof typeof CombinationVerdict];

export interface InvoiceCombination {
  readonly verdict: CombinationVerdict;
  /** The other row of the pair, when the Excel names one. */
  readonly partnerRowNumber: number | null;
  /** Why a pair is under review; null otherwise. */
  readonly reason: string | null;
}

export interface InvoiceRowMatch {
  readonly row: InvoiceSheetRow;
  readonly status: InvoiceRowStatus;
  /** The one CLOSED Trip, when there is exactly one. */
  readonly trip: Trip | null;
  /**
   * Every Trip this line could be about, whatever its status — for the
   * ambiguous case, which must name what it could not choose between, and for
   * NOT_FINISHED and CONFLICT, which name the Trip concerned.
   */
  readonly candidates: readonly Trip[];
  /**
   * The other rows of this same document stating the same three values — the
   * rows of one transport split over several lines, read together.
   */
  readonly sharedKeyRowNumbers: readonly number[];
  /** Null unless the invoice's container was wrong and is to be corrected. */
  readonly containerCorrection: ContainerCorrection | null;
  /** Null unless the invoice's booking was wrong and is to be corrected. */
  readonly bookingCorrection: BookingCorrection | null;
  /** Null unless the invoice's date was wrong and is to be corrected. */
  readonly dateCorrection: DateCorrection | null;
  /** The confirmation a COST_LINE charges. */
  readonly costConfirmation: InvoiceCostConfirmation | null;
  /** Set on a line the Excel marks as half of a Combination. */
  readonly combination: InvoiceCombination | null;
  /** Why the line could not be resolved, in a sentence a report can carry. */
  readonly problem: string | null;
}
