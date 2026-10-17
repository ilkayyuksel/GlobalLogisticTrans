import type { ExaminedInvoice } from "./invoice-examination.service";
import {
  InvoiceRowStatus,
  type BookingCorrection,
  type ContainerCorrection,
  type InvoiceRowMatch,
} from "./matching/invoice-row-matching.service";
import { InvoicePricingStatus, type InvoiceRowPricing } from "./pricing/invoice-reconciliation";
import type { RemarkChange } from "./remarks/remark-plan";
import { planChanges, type ChangePlan } from "./workbook/change-plan";
import type { WorkbookCorrections } from "./workbook/invoice-sheet.writer";

/**
 * The lines the corrected document marks yellow.
 *
 * The ones the match could not resolve, and every line whose price could not
 * be compared safely: a difference no cell may carry, a stored price nobody can
 * stand behind, an amount cell that holds no amount, a Combination under
 * review. A line that was matched and priced is not marked, however much its
 * amounts had to change — a correction is an answer, not a problem.
 */
const MARKED_LINE_STATUSES: readonly InvoiceRowStatus[] = [
  InvoiceRowStatus.NOT_FOUND,
  InvoiceRowStatus.NOT_FINISHED,
  InvoiceRowStatus.AMBIGUOUS,
  InvoiceRowStatus.CONFLICT,
  InvoiceRowStatus.COST_LINE_UNRESOLVED,
];

const MARKED_PRICING_STATUSES: readonly InvoicePricingStatus[] = [
  InvoicePricingStatus.NOT_DISTRIBUTABLE,
  InvoicePricingStatus.PRICE_UNRELIABLE,
  InvoicePricingStatus.AMOUNT_UNREADABLE,
  InvoicePricingStatus.COMBINATION_REVIEW,
];

export function toMarkedRowNumbers(
  matches: readonly InvoiceRowMatch[],
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
): number[] {
  return matches
    .filter((match) => {
      const status = pricing.get(match.row.rowNumber)?.status;

      return (
        MARKED_LINE_STATUSES.includes(match.status) ||
        (status !== undefined && MARKED_PRICING_STATUSES.includes(status))
      );
    })
    .map((match) => match.row.rowNumber);
}

/** Everything the examination planned into the document beside its amounts. */
export function toWorkbookCorrections(examined: ExaminedInvoice): WorkbookCorrections {
  return {
    added: examined.added,
    fuelHeader: examined.fuelHeader,
    problemRowNumbers: toMarkedRowNumbers(examined.matches, examined.pricing),
    containerCorrections: byRow(examined.matches, (match) => match.containerCorrection),
    bookingCorrections: byRow(examined.matches, (match) => match.bookingCorrection),
    remarks: toCompletedRemarks(examined.remarks),
  };
}

/** Every change the corrected document may contain, decided before writing. */
export function toChangePlan(examined: ExaminedInvoice, corrections: WorkbookCorrections): ChangePlan {
  return planChanges({
    sheet: examined.opened.sheet,
    pricing: examined.pricing,
    yellowRowNumbers: corrections.problemRowNumbers ?? [],
    containerCorrections: corrections.containerCorrections ?? new Map(),
    bookingCorrections: corrections.bookingCorrections ?? new Map(),
    remarks: corrections.remarks ?? new Map(),
    fuelHeader: examined.fuelHeader,
    added: examined.added,
    firstAddedRowNumber: examined.firstAddedRowNumber,
    structureSound: examined.structure.sound,
  });
}

/** The Remarks this check completes, as each cell will hold them. */
function toCompletedRemarks(changes: ReadonlyMap<number, RemarkChange>): Map<number, string> {
  return new Map(
    [...changes.values()]
      .filter((change) => change.added.length > 0)
      .map((change) => [change.rowNumber, change.after]),
  );
}

/** A misprinted number of a line, by the row whose cell the document replaces. */
function byRow<T extends ContainerCorrection | BookingCorrection>(
  matches: readonly InvoiceRowMatch[],
  correctionOf: (match: InvoiceRowMatch) => T | null,
): Map<number, T> {
  return new Map(
    matches.flatMap((match) => {
      const correction = correctionOf(match);

      return correction === null ? [] : [[match.row.rowNumber, correction] as const];
    }),
  );
}
