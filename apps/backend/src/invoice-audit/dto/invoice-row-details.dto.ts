import { ApiProperty } from "@nestjs/swagger";
import { Prisma, RouteMatchMethod } from "@prisma/client";

import { CombinationVerdict } from "../matching/invoice-row-matching.service";
import { DifferenceKind, type InvoicePricingDifference } from "../pricing/invoice-reconciliation";
import { PriceProblem, type PriceReliability } from "../pricing/price-reliability";

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
    enum: DifferenceKind,
    description:
      "RAISE: the amount goes up to this system's figure. REMOVE: the Backload of an established GEEN COMBI. KEEP_AMOUNT: the cell is rewritten so its amount stays (a Fuel formula that would follow a raised Tarief). INVOICE_HIGHER: the invoice states more than this system holds; never lowered, only reported. NOT_PLACEABLE / UNREADABLE: nothing on the line is written.",
  })
  kind!: DifferenceKind;

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

/**
 * The Trip's road beside the road its price was made on, and how the system
 * matched them — information for the operator, never the reason a price is
 * doubted (that is `problem`, from the stored match itself).
 */
export class InvoiceRouteDescriptionDto {
  @ApiProperty({ enum: RouteMatchMethod, nullable: true, description: "As the snapshot recorded it." })
  matchMethod!: RouteMatchMethod | null;

  @ApiProperty({ type: String, nullable: true, example: "Eindhout → Quay 869" })
  tripRoute!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "LAAKDAL (EINDHOUT) → Quay 869" })
  pricedRoute!: string | null;
}

/** Whether the Trip's stored price could be relied on, and why not. */
export class InvoicePriceReliabilityDto {
  @ApiProperty()
  reliable!: boolean;

  @ApiProperty({ enum: PriceProblem, nullable: true })
  problem!: PriceProblem | null;

  @ApiProperty({ type: String, nullable: true })
  explanation!: string | null;

  @ApiProperty({ type: InvoiceRouteDescriptionDto, nullable: true })
  route!: InvoiceRouteDescriptionDto | null;
}

/**
 * The invoice named the right transport with the wrong container.
 *
 * Present only on a line matched by its date and booking alone, because no Trip
 * held the container it printed and exactly one Trip shared its booking and day.
 * The corrected document states `tripContainerNumber` in that cell, in red.
 */
export class InvoiceContainerCorrectionDto {
  @ApiProperty({ example: "EUCU 9999999", description: "As the sheet spelled it." })
  invoiceContainerNumber!: string;

  @ApiProperty({
    example: "EUCU4581604",
    description: "The Trip's own container, exactly as this system stores it.",
  })
  tripContainerNumber!: string;
}

/** The invoice named the right transport with the wrong booking number. */
export class InvoiceBookingCorrectionDto {
  @ApiProperty({ example: "ANRDUB2810000", description: "As the sheet spelled it." })
  invoiceBookingNumber!: string;

  @ApiProperty({ example: "ANRDUB2810849", description: "The Trip's own booking number." })
  tripBookingNumber!: string;
}

/** The day a line stated, and the Trip's own planning date it is corrected to. */
export class InvoiceDateCorrectionDto {
  @ApiProperty({ format: "date", example: "2026-10-06", description: "As the sheet stated it." })
  invoicePlanningDate!: string;

  @ApiProperty({ format: "date", example: "2026-10-07", description: "The Trip's own planningDate." })
  tripPlanningDate!: string;
}

/** The Cost Confirmation a Cost Confirmation line was resolved to. */
export class InvoiceCostConfirmationDto {
  @ApiProperty({ example: "4220981", description: "Digits only; the sheet prints `EC 4220981`." })
  ccNumber!: string;

  @ApiProperty({ example: "110.00", description: "What the confirmation charges." })
  amount!: string;
}

/** What the Excel's Combination marking came to, against the system's grouping. */
export class InvoiceCombinationDto {
  @ApiProperty({
    enum: CombinationVerdict,
    description:
      "RECOGNISED: the system's own group of exactly these two Trips. GEEN_COMBI: neither Trip belongs to any group — the Backload is removed. REVIEW: the pair cannot be established reliably.",
  })
  verdict!: CombinationVerdict;

  @ApiProperty({ type: Number, nullable: true })
  partnerRowNumber!: number | null;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
}

/** The Remarks of a line, completed in the customer's own words. */
export class InvoiceRemarksDto {
  @ApiProperty({ example: "tar,EC 4220979", description: "As the invoice states them." })
  before!: string;

  @ApiProperty({ example: "tar,EC 4220979,GEEN COMBI", description: "As the corrected document will." })
  after!: string;

  @ApiProperty({ type: [String], example: ["GEEN COMBI"] })
  added!: string[];

  @ApiProperty({
    type: [String],
    description: "A waiting time with no customer spelling, a word this invoice does not use yet.",
  })
  notes!: string[];
}

export function toDifferenceDto(
  difference: InvoicePricingDifference,
): InvoicePricingDifferenceDto {
  return {
    component: difference.component,
    kind: difference.kind,
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

export function toPriceReliabilityDto(
  reliability: PriceReliability,
): InvoicePriceReliabilityDto {
  return {
    reliable: reliability.reliable,
    problem: reliability.problem,
    explanation: reliability.explanation,
    route: reliability.route ? { ...reliability.route } : null,
  };
}

export function toMoney(amount: Prisma.Decimal | null): string | null {
  return amount === null ? null : amount.toFixed(MONEY_DECIMAL_PLACES);
}
