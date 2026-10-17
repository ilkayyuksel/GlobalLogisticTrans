import { ApiProperty } from "@nestjs/swagger";
import { Trip, TripStatus } from "@prisma/client";

import { toIsoDate } from "../../common/dates";
import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-matching.service";
import { InvoicePricingStatus, type InvoiceRowPricing } from "../pricing/invoice-reconciliation";
import type { RemarkChange } from "../remarks/remark-plan";
import { MONEY_DECIMAL_PLACES } from "../workbook/invoice-amounts";
import {
  InvoiceBookingCorrectionDto,
  InvoiceCombinationDto,
  InvoiceContainerCorrectionDto,
  InvoiceCostConfirmationDto,
  InvoicePriceReliabilityDto,
  InvoicePricingDifferenceDto,
  InvoiceRemarksDto,
  toDifferenceDto,
  toPriceReliabilityDto,
} from "./invoice-row-details.dto";

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

  @ApiProperty({
    type: InvoicePriceReliabilityDto,
    nullable: true,
    description:
      "Whether the matched Trip's stored price could be relied on. Null for a line that was not compared.",
  })
  priceReliability!: InvoicePriceReliabilityDto | null;

  @ApiProperty({
    type: InvoiceContainerCorrectionDto,
    nullable: true,
    description:
      "Null for every line whose container was right. Set only on a MATCHED line found by its date and booking because its container matched no Trip.",
  })
  containerCorrection!: InvoiceContainerCorrectionDto | null;

  @ApiProperty({
    type: InvoiceBookingCorrectionDto,
    nullable: true,
    description:
      "Set only on a MATCHED line no Trip shared its booking with on that day, whose container on that day belongs to exactly one Trip.",
  })
  bookingCorrection!: InvoiceBookingCorrectionDto | null;

  @ApiProperty({ type: InvoiceCostConfirmationDto, nullable: true })
  costConfirmation!: InvoiceCostConfirmationDto | null;

  @ApiProperty({ type: InvoiceCombinationDto, nullable: true })
  combination!: InvoiceCombinationDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Why the line could not be resolved: a conflict, an unknown confirmation.",
  })
  matchProblem!: string | null;

  @ApiProperty({
    type: InvoiceRemarksDto,
    nullable: true,
    description: "What this check adds to the line's Remarks, and what it could not write.",
  })
  remarks!: InvoiceRemarksDto | null;
}

export function toInvoiceAuditRowDto(
  match: InvoiceRowMatch,
  pricing: InvoiceRowPricing | undefined,
  remarks?: RemarkChange,
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
    priceReliability: pricing?.reliability
      ? toPriceReliabilityDto(pricing.reliability)
      : null,
    containerCorrection: match.containerCorrection
      ? { ...match.containerCorrection }
      : null,
    bookingCorrection: match.bookingCorrection ? { ...match.bookingCorrection } : null,
    costConfirmation: match.costConfirmation
      ? {
          ccNumber: match.costConfirmation.ccNumber,
          amount: match.costConfirmation.amount.toFixed(MONEY_DECIMAL_PLACES),
        }
      : null,
    combination: match.combination ? { ...match.combination } : null,
    matchProblem: match.problem,
    remarks: remarks
      ? {
          before: remarks.before,
          after: remarks.after,
          added: [...remarks.added],
          notes: [...remarks.notes],
        }
      : null,
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
