import { ApiProperty } from "@nestjs/swagger";

import {
  CombinationVerdict,
  InvoiceRowStatus,
  type InvoiceRowMatch,
} from "../matching/invoice-row-matching.service";
import { InvoicePricingStatus, type InvoiceRowPricing } from "../pricing/invoice-reconciliation";

/** How many lines ended in each answer. */
export class InvoiceAuditSummaryDto {
  @ApiProperty({ example: 98 })
  totalRows!: number;

  @ApiProperty({ example: 94 })
  matched!: number;

  @ApiProperty({ example: 2 })
  notFound!: number;

  @ApiProperty({ example: 2 })
  notFinished!: number;

  @ApiProperty({ example: 0 })
  ambiguous!: number;

  @ApiProperty({
    example: 94,
    description: "Matched lines whose pricing was compared.",
  })
  priceChecked!: number;

  @ApiProperty({ example: 71, description: "Compared, and already correct." })
  priceUnchanged!: number;

  @ApiProperty({ example: 23, description: "Compared, and at least one amount raised." })
  priceCorrected!: number;

  @ApiProperty({
    example: 4,
    description:
      "Compared, nothing raised, and the invoice states more than this system holds for at least one amount. Never lowered.",
  })
  priceInvoiceHigher!: number;

  @ApiProperty({
    example: 0,
    description:
      "Compared, differing, and not correctable: the component is stated on several rows of the invoice.",
  })
  priceNotDistributable!: number;

  @ApiProperty({
    example: 3,
    description:
      "Matched, but the Trip's stored price cannot be relied on: no snapshot, no route, an unconfirmed route or an outdated Combination.",
  })
  priceUnreliable!: number;

  @ApiProperty({
    example: 0,
    description: "Matched, but an amount cell holds something that is not an amount.",
  })
  amountUnreadable!: number;

  @ApiProperty({
    example: 38,
    description: "Cells the corrected workbook would write.",
  })
  correctedCells!: number;

  @ApiProperty({
    example: 2,
    description:
      "Finished, unpaid transports of this period that the invoice does not mention.",
  })
  missingTrips!: number;

  @ApiProperty({ example: 0, description: "Missing transports not added because a line could be them." })
  blockedMissingTrips!: number;

  @ApiProperty({ example: 0, description: "Lines whose booking number is corrected." })
  bookingCorrected!: number;

  @ApiProperty({ example: 0, description: "Lines whose date is corrected to their Trip's planning date." })
  dateCorrected!: number;

  @ApiProperty({ example: 0, description: "Lines whose correction would reach a Trip another line is." })
  conflicts!: number;

  @ApiProperty({ example: 3, description: "Cost Confirmation lines resolved to their confirmation." })
  costLines!: number;

  @ApiProperty({ example: 0, description: "Cost Confirmation lines that could not be resolved." })
  costLinesUnresolved!: number;

  @ApiProperty({ example: 20, description: "Rows of Combinations the system recognises." })
  combinationsRecognised!: number;

  @ApiProperty({ example: 2, description: "Rows of Excel Combinations that are none: GEEN COMBI." })
  geenCombi!: number;

  @ApiProperty({ example: 0, description: "Rows of Excel Combinations under review." })
  combinationsReview!: number;

  @ApiProperty({
    example: 2,
    description:
      "Lines a previous run of this check wrote into this document. They are priced and corrected like any other line and are never settled.",
  })
  addedMissing!: number;

  @ApiProperty({
    example: 1,
    description:
      "MATCHED lines whose container was wrong and is corrected to the Trip's own. Counted within `matched` too.",
  })
  containerCorrected!: number;
}

export function toInvoiceAuditSummaryDto(
  matches: readonly InvoiceRowMatch[],
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
  missingTrips: number,
  blockedMissingTrips: number = 0,
): InvoiceAuditSummaryDto {
  const count = (status: InvoiceRowStatus) =>
    matches.filter((match) => match.status === status).length;

  const outcomes = matches.map((match) => pricing.get(match.row.rowNumber));
  const priced = (status: InvoicePricingStatus) =>
    outcomes.filter((outcome) => outcome?.status === status).length;
  const verdict = (value: CombinationVerdict) =>
    matches.filter((match) => match.combination?.verdict === value).length;

  return {
    totalRows: matches.length,
    matched: count(InvoiceRowStatus.MATCHED),
    notFound: count(InvoiceRowStatus.NOT_FOUND),
    notFinished: count(InvoiceRowStatus.NOT_FINISHED),
    ambiguous: count(InvoiceRowStatus.AMBIGUOUS),
    addedMissing: count(InvoiceRowStatus.ADDED_MISSING),
    containerCorrected: matches.filter(
      (match) => match.containerCorrection !== null,
    ).length,
    priceChecked:
      priced(InvoicePricingStatus.MATCHED_NO_CHANGES) +
      priced(InvoicePricingStatus.PRICING_CORRECTED) +
      priced(InvoicePricingStatus.INVOICE_HIGHER) +
      priced(InvoicePricingStatus.NOT_DISTRIBUTABLE),
    priceUnchanged: priced(InvoicePricingStatus.MATCHED_NO_CHANGES),
    priceCorrected: priced(InvoicePricingStatus.PRICING_CORRECTED),
    priceInvoiceHigher: priced(InvoicePricingStatus.INVOICE_HIGHER),
    priceNotDistributable: priced(InvoicePricingStatus.NOT_DISTRIBUTABLE),
    priceUnreliable: priced(InvoicePricingStatus.PRICE_UNRELIABLE),
    amountUnreadable: priced(InvoicePricingStatus.AMOUNT_UNREADABLE),
    correctedCells: outcomes.reduce(
      (total, outcome) =>
        total +
        (outcome?.differences ?? []).filter((difference) => difference.write !== null)
          .length,
      0,
    ),
    missingTrips,
    blockedMissingTrips,
    bookingCorrected: matches.filter((match) => match.bookingCorrection !== null).length,
    dateCorrected: matches.filter((match) => match.dateCorrection !== null).length,
    conflicts: count(InvoiceRowStatus.CONFLICT),
    costLines: count(InvoiceRowStatus.COST_LINE),
    costLinesUnresolved: count(InvoiceRowStatus.COST_LINE_UNRESOLVED),
    combinationsRecognised: verdict(CombinationVerdict.RECOGNISED),
    geenCombi: verdict(CombinationVerdict.GEEN_COMBI),
    // Under review either way: the Excel's pair is doubtful, or the system did
    // not price the two halves as one Combination.
    combinationsReview: matches.filter(
      (match) =>
        match.combination?.verdict === CombinationVerdict.REVIEW ||
        pricing.get(match.row.rowNumber)?.status === InvoicePricingStatus.COMBINATION_REVIEW,
    ).length,
  };
}
