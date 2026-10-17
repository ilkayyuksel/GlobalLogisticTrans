import { ApiProperty } from "@nestjs/swagger";

import type { ExaminedInvoice } from "../invoice-examination.service";
import type { TripPayment } from "../payment/payment-eligibility";
import type { ColumnTotal } from "../workbook/line-totals";
import {
  InvoiceFuelHeaderChangeDto,
  InvoiceTotalsDto,
  InvoiceTotalsStructureDto,
  toFuelHeaderChangeDto,
  toTotalsDto,
  toTotalsStructureDto,
} from "./invoice-document.dto";
import {
  BlockedMissingTripDto,
  MissingTripDto,
  toBlockedMissingTripDto,
  toMissingTripDto,
} from "./invoice-missing.dto";
import { InvoiceTripPaymentDto, toTripPaymentDto } from "./invoice-payment.dto";
import { InvoiceAuditRowDto, toInvoiceAuditRowDto } from "./invoice-row.dto";
import { InvoiceAuditSummaryDto, toInvoiceAuditSummaryDto } from "./invoice-summary.dto";

/** The days the invoice covers, read from the lines themselves. */
export class InvoiceAuditPeriodDto {
  @ApiProperty({ format: "date", example: "2026-03-23" })
  from!: string;

  @ApiProperty({ format: "date", example: "2026-03-27" })
  to!: string;
}

/**
 * What one check produced: the preview of the corrected document and of what
 * a payment confirmation may settle.
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
      "Finished, unpaid transports of this period the invoice does not state. The corrected workbook adds each of them as a line directly above the totals row, when the totals can take it.",
  })
  missingTrips!: MissingTripDto[];

  @ApiProperty({
    type: [BlockedMissingTripDto],
    description:
      "Transports the invoice does not state that are NOT added, because an unresolved line could be that very transport.",
  })
  blockedMissingTrips!: BlockedMissingTripDto[];

  @ApiProperty({ type: InvoiceTotalsStructureDto })
  totalsStructure!: InvoiceTotalsStructureDto;

  @ApiProperty({
    type: InvoiceFuelHeaderChangeDto,
    nullable: true,
    description: "Null when the Fuel header stays as the customer wrote it.",
  })
  fuelHeader!: InvoiceFuelHeaderChangeDto | null;

  @ApiProperty({
    type: [Number],
    description: "The rows the corrected document marks yellow; each row's statuses say why.",
  })
  markedRowNumbers!: number[];

  @ApiProperty({ type: InvoiceTotalsDto })
  totals!: InvoiceTotalsDto;

  @ApiProperty({
    type: [InvoiceTripPaymentDto],
    description:
      "Every transport the invoice charges, and whether a confirmation may settle it. Nothing is paid by a check or by the corrected file.",
  })
  payments!: InvoiceTripPaymentDto[];
}

/** What the preview needs beside the examination itself. */
export interface InvoicePreviewFacts {
  readonly markedRowNumbers: readonly number[];
  readonly totalsBefore: readonly ColumnTotal[];
  readonly totalsAfter: readonly ColumnTotal[];
  readonly payments: readonly TripPayment[];
}

export function toInvoiceAuditResultDto(
  examined: ExaminedInvoice,
  facts: InvoicePreviewFacts,
): InvoiceAuditResultDto {
  const { matches, pricing, remarks, missing, opened } = examined;

  return {
    fileName: examined.fileName,
    sheetName: opened.sheet.sheetName,
    period: examined.period,
    summary: toInvoiceAuditSummaryDto(matches, pricing, missing.length, examined.blocked.length),
    rows: matches.map((match) =>
      toInvoiceAuditRowDto(match, pricing.get(match.row.rowNumber), remarks.get(match.row.rowNumber)),
    ),
    incompleteRowNumbers: [...opened.sheet.incompleteRowNumbers],
    missingTrips: missing.map((trip, index) =>
      toMissingTripDto(
        trip,
        examined.firstAddedRowNumber === null ? null : examined.firstAddedRowNumber + index,
      ),
    ),
    blockedMissingTrips: examined.blocked.map(toBlockedMissingTripDto),
    totalsStructure: toTotalsStructureDto(examined.structure),
    fuelHeader: toFuelHeaderChangeDto(examined.fuelHeader),
    markedRowNumbers: [...facts.markedRowNumbers],
    totals: toTotalsDto(facts.totalsBefore, facts.totalsAfter),
    payments: facts.payments.map(toTripPaymentDto),
  };
}
