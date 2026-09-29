import { ApiProperty } from "@nestjs/swagger";
import { Prisma, Trip, TripStatus } from "@prisma/client";

import { toIsoDate } from "../../common/dates";
import {
  InvoiceRowStatus,
  type InvoiceRowMatch,
} from "../matching/invoice-row-matching.service";
import type { MissingTrip } from "../missing/missing-trips.service";
import {
  InvoicePricingStatus,
  type InvoicePricingDifference,
  type InvoiceRowPricing,
} from "../pricing/invoice-reconciliation";
import { MONEY_DECIMAL_PLACES } from "../workbook/invoice-amounts";
import { toHeaderText } from "../workbook/invoice-columns";

/**
 * One component of one line: what the invoice charges, what this system holds,
 * and what the corrected document will say.
 *
 * Amounts travel as STRINGS at the money precision, exactly as every other
 * pricing response in this system does — a JSON number would round a cent away
 * in a currency nobody can see it happen in.
 */
export class InvoicePricingDifferenceDto {
  @ApiProperty({ example: "Tarief", description: "The customer's own column name." })
  component!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Tol B",
    description: "The column a correction is written into, when one can be.",
  })
  column!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "364.00",
    description:
      "What the invoice states, added up over the rows sharing this line. Null when it states nothing.",
  })
  invoiceValue!: string | null;

  @ApiProperty({ example: "370.00", description: "What this system holds." })
  expectedValue!: string;

  @ApiProperty({
    example: "6.00",
    description: "Expected minus stated: positive when the invoice charges too little.",
  })
  difference!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "370.00",
    description: "What the cell will hold. Null when nothing is written.",
  })
  correctedValue!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "The row whose cell carries the correction.",
  })
  correctionRowNumber!: number | null;

  @ApiProperty({
    description:
      "The cell is a formula that already produces the right amount once the Tarief is corrected, so the formula stays and only its cached result is refreshed.",
  })
  keepsFormula!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Why nothing is written, when nothing is.",
  })
  problem!: string | null;
}

/** What this system holds for the Trip an invoice line was matched to. */
export class InvoiceAuditTripDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ enum: TripStatus })
  status!: TripStatus;

  @ApiProperty({ type: String, nullable: true, format: "date" })
  planningDate!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bookingNumber!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "As this system stores it, which may be spelled without spaces.",
  })
  containerNumber!: string | null;
}

/**
 * One line of the invoice, with what became of it.
 *
 * ── THE ROW NUMBER IS THE ROW'S OWN ─────────────────────────────────────────
 * It is the line's number in the workbook, not its position in this list. The
 * corrected document is produced by writing into those exact rows, and the
 * screen shows it so an operator can find the line in their own file.
 */
export class InvoiceAuditRowDto {
  @ApiProperty({ example: 7, description: "The row's number in the worksheet." })
  rowNumber!: number;

  @ApiProperty({ enum: InvoiceRowStatus })
  status!: InvoiceRowStatus;

  @ApiProperty({ format: "date", description: "The Planning date the line states." })
  planningDate!: string;

  @ApiProperty({ example: "ANRDUB2725107" })
  bookingNumber!: string;

  @ApiProperty({
    example: "EUCU 4581604",
    description: "Exactly as the sheet spells it.",
  })
  containerNumber!: string;

  @ApiProperty({
    example: "EUCU4581604",
    description: "The same container, as the match compared it.",
  })
  normalizedContainerNumber!: string;

  @ApiProperty({ type: InvoiceAuditTripDto, nullable: true })
  trip!: InvoiceAuditTripDto | null;

  @ApiProperty({
    type: [InvoiceAuditTripDto],
    description:
      "Every Trip sharing this line's three values, whatever its status. Empty for a line nothing matches; several for an ambiguous one; the unfinished Trip for a line that found one.",
  })
  candidates!: InvoiceAuditTripDto[];

  @ApiProperty({
    type: [Number],
    description:
      "Other rows of this same document stating the same three values. A weekly invoice prints one line per Cost Confirmation, so a shared key is ordinary and is never merged away.",
  })
  sharedKeyRowNumbers!: number[];

  @ApiProperty({
    enum: InvoicePricingStatus,
    description:
      "What the pricing check concluded. Only a line matched to exactly one CLOSED Trip is ever compared.",
  })
  pricingStatus!: InvoicePricingStatus;

  @ApiProperty({ type: [InvoicePricingDifferenceDto] })
  differences!: InvoicePricingDifferenceDto[];
}

/**
 * A finished transport the invoice never mentioned, and what it is worth.
 *
 * Reported whether or not a corrected workbook is produced, so the screen can
 * say WHY a line will be added before anybody downloads anything.
 */
export class MissingTripDto {
  @ApiProperty({ format: "uuid" })
  tripId!: string;

  @ApiProperty({ format: "date", example: "2026-03-23" })
  planningDate!: string;

  @ApiProperty({ type: String, nullable: true, example: "BELANR2720016" })
  bookingNumber!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "EUCU2451828" })
  containerNumber!: string | null;

  @ApiProperty({ example: "Quay 869 -> MELSELE" })
  route!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The effective Tarief, or null when the Trip has never been priced.",
  })
  tarief!: string | null;

  @ApiProperty({ type: String, nullable: true })
  totaal!: string | null;

  @ApiProperty({
    example: 102,
    description:
      "The row the corrected workbook writes it on — below the summary block, where nothing existing has to move.",
  })
  rowNumber!: number;
}

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

  @ApiProperty({ example: 23, description: "Compared, and corrected." })
  priceCorrected!: number;

  @ApiProperty({
    example: 0,
    description:
      "Compared, differing, and not correctable: the component is stated on several rows of the invoice.",
  })
  priceNotDistributable!: number;

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

  @ApiProperty({
    example: 2,
    description:
      "Lines a previous run of this check wrote into this document. They are priced and corrected like any other line and are never settled.",
  })
  addedMissing!: number;
}

/** The days the invoice covers, read from the lines themselves. */
export class InvoiceAuditPeriodDto {
  @ApiProperty({ format: "date", example: "2026-03-23" })
  from!: string;

  @ApiProperty({ format: "date", example: "2026-03-27" })
  to!: string;
}

/**
 * What one check produced.
 *
 * Nothing is stored: this is the whole result, and re-uploading the document
 * produces it again. There is deliberately no audit table — the invoice is the
 * record, and a second one would be a second truth to keep in step.
 */
export class InvoiceAuditResultDto {
  @ApiProperty({ example: "week 13 - 2026 GLT.xlsx" })
  fileName!: string;

  @ApiProperty({ example: "Sheet1" })
  sheetName!: string;

  @ApiProperty({
    type: InvoiceAuditPeriodDto,
    nullable: true,
    description:
      "From the Planning date values themselves, never from the file name. Null when the sheet holds no line.",
  })
  period!: InvoiceAuditPeriodDto | null;

  @ApiProperty({ type: InvoiceAuditSummaryDto })
  summary!: InvoiceAuditSummaryDto;

  @ApiProperty({ type: [InvoiceAuditRowDto] })
  rows!: InvoiceAuditRowDto[];

  @ApiProperty({
    type: [Number],
    description:
      "Rows that state something but not all three identity values, so they could not be a line. Reported rather than skipped silently; never matched.",
  })
  incompleteRowNumbers!: number[];

  @ApiProperty({
    type: [MissingTripDto],
    description:
      "Finished, unpaid transports of this period the invoice does not state. The corrected workbook adds each of them as a line below the summary block.",
  })
  missingTrips!: MissingTripDto[];
}

export function toInvoiceAuditRowDto(
  match: InvoiceRowMatch,
  pricing: InvoiceRowPricing | undefined,
): InvoiceAuditRowDto {
  return {
    rowNumber: match.row.rowNumber,
    status: match.status,
    planningDate: match.row.planningDate,
    bookingNumber: match.row.bookingNumber,
    containerNumber: match.row.containerNumber,
    normalizedContainerNumber: match.row.normalizedContainerNumber,
    trip: match.trip ? toInvoiceAuditTripDto(match.trip) : null,
    candidates: match.candidates.map(toInvoiceAuditTripDto),
    sharedKeyRowNumbers: [...match.sharedKeyRowNumbers],
    pricingStatus: pricing?.status ?? InvoicePricingStatus.NOT_COMPARED,
    differences: (pricing?.differences ?? []).map(toDifferenceDto),
  };
}

function toDifferenceDto(
  difference: InvoicePricingDifference,
): InvoicePricingDifferenceDto {
  return {
    component: difference.component,
    column: difference.column ? toHeaderText(difference.column) : null,
    invoiceValue: toMoney(difference.invoiceValue),
    expectedValue: difference.expectedValue.toFixed(MONEY_DECIMAL_PLACES),
    difference: difference.difference.toFixed(MONEY_DECIMAL_PLACES),
    correctedValue: toMoney(difference.correctedValue),
    correctionRowNumber: difference.correctionRowNumber,
    keepsFormula: difference.keepsFormula,
    problem: difference.problem,
  };
}

function toMoney(amount: Prisma.Decimal | null): string | null {
  return amount === null ? null : amount.toFixed(MONEY_DECIMAL_PLACES);
}

export function toMissingTripDto(
  missing: MissingTrip,
  rowNumber: number,
): MissingTripDto {
  return {
    tripId: missing.trip.id,
    planningDate: missing.trip.planningDate
      ? toIsoDate(missing.trip.planningDate)
      : "",
    bookingNumber: missing.trip.bookingNumber,
    containerNumber: missing.trip.containerNumber,
    route: missing.route,
    tarief: missing.pricing
      ? missing.pricing.tarief.toFixed(MONEY_DECIMAL_PLACES)
      : null,
    totaal: missing.pricing
      ? missing.pricing.totaal.toFixed(MONEY_DECIMAL_PLACES)
      : null,
    rowNumber,
  };
}

export function toInvoiceAuditTripDto(trip: Trip): InvoiceAuditTripDto {
  return {
    id: trip.id,
    status: trip.status,
    planningDate: trip.planningDate ? toIsoDate(trip.planningDate) : null,
    bookingNumber: trip.bookingNumber,
    containerNumber: trip.containerNumber,
  };
}

export function toInvoiceAuditSummaryDto(
  matches: readonly InvoiceRowMatch[],
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
  missingTrips: number,
): InvoiceAuditSummaryDto {
  const count = (status: InvoiceRowStatus) =>
    matches.filter((match) => match.status === status).length;

  const outcomes = matches.map((match) => pricing.get(match.row.rowNumber));
  const priced = (status: InvoicePricingStatus) =>
    outcomes.filter((outcome) => outcome?.status === status).length;

  return {
    totalRows: matches.length,
    matched: count(InvoiceRowStatus.MATCHED),
    notFound: count(InvoiceRowStatus.NOT_FOUND),
    notFinished: count(InvoiceRowStatus.NOT_FINISHED),
    ambiguous: count(InvoiceRowStatus.AMBIGUOUS),
    addedMissing: count(InvoiceRowStatus.ADDED_MISSING),
    priceChecked:
      priced(InvoicePricingStatus.MATCHED_NO_CHANGES) +
      priced(InvoicePricingStatus.PRICING_CORRECTED) +
      priced(InvoicePricingStatus.NOT_DISTRIBUTABLE),
    priceUnchanged: priced(InvoicePricingStatus.MATCHED_NO_CHANGES),
    priceCorrected: priced(InvoicePricingStatus.PRICING_CORRECTED),
    priceNotDistributable: priced(InvoicePricingStatus.NOT_DISTRIBUTABLE),
    correctedCells: outcomes.reduce(
      (total, outcome) =>
        total +
        (outcome?.differences ?? []).filter(
          (difference) => difference.correctedValue !== null,
        ).length,
      0,
    ),
    missingTrips,
  };
}
