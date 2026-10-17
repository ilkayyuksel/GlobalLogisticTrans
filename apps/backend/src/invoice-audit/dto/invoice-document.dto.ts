import { ApiProperty } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";

import { MONEY_DECIMAL_PLACES } from "../workbook/invoice-amounts";
import { toHeaderText } from "../workbook/invoice-columns";
import type { FuelHeaderChange, TextChange } from "../workbook/fuel-header";
import type { ColumnTotal } from "../workbook/line-totals";
import type { TotalsStructure } from "../workbook/totals-structure";

/**
 * Whether the document's totals can take added lines. When they cannot, no line
 * is added and no Fuel header changes; the deviations are listed as found.
 */
export class InvoiceTotalsStructureDto {
  @ApiProperty({ example: true })
  sound!: boolean;

  @ApiProperty({
    type: [String],
    example: ["Backload: het totaal telt de rijen 2–138 op in plaats van 2–141 (SUM(N2:N138))."],
  })
  problems!: string[];
}

/** One text cell the corrected document rewrites, before and after. */
export class InvoiceTextChangeDto {
  @ApiProperty({ example: "M1" })
  address!: string;

  @ApiProperty({ example: "Fuel 23% " })
  before!: string;

  @ApiProperty({ example: "Fuel 24% " })
  after!: string;
}

/** The Fuel header and summary label, when the whole column states one new percentage. */
export class InvoiceFuelHeaderChangeDto {
  @ApiProperty({ example: "24" })
  percentage!: string;

  @ApiProperty({ type: InvoiceTextChangeDto })
  header!: InvoiceTextChangeDto;

  @ApiProperty({ type: InvoiceTextChangeDto, nullable: true })
  label!: InvoiceTextChangeDto | null;
}

/** One amount column, added up over the lines, before and after the correction. */
export class InvoiceColumnTotalDto {
  @ApiProperty({ example: "Backload" })
  column!: string;

  @ApiProperty({ example: "1300.00" })
  before!: string;

  @ApiProperty({ example: "0.00" })
  after!: string;
}

/**
 * The invoice's amounts before and after the correction: the customer's lines
 * as received, and the same lines plus the added ones as the corrected document
 * states them.
 */
export class InvoiceTotalsDto {
  @ApiProperty({ type: [InvoiceColumnTotalDto] })
  columns!: InvoiceColumnTotalDto[];

  @ApiProperty({ example: "29210.30" })
  before!: string;

  @ApiProperty({ example: "27910.30" })
  after!: string;
}

export function toTotalsDto(
  before: readonly ColumnTotal[],
  after: readonly ColumnTotal[],
): InvoiceTotalsDto {
  const money = (amount: { toFixed(places: number): string }) => amount.toFixed(MONEY_DECIMAL_PLACES);
  const sum = (totals: readonly ColumnTotal[]) =>
    totals.reduce((total, column) => total.plus(column.total), new Prisma.Decimal(0));

  return {
    columns: before.map((column, index) => ({
      column: toHeaderText(column.column),
      before: money(column.total),
      after: money(after[index].total),
    })),
    before: money(sum(before)),
    after: money(sum(after)),
  };
}

export function toTotalsStructureDto(structure: TotalsStructure): InvoiceTotalsStructureDto {
  return { sound: structure.sound, problems: [...structure.problems] };
}

export function toFuelHeaderChangeDto(
  change: FuelHeaderChange | null,
): InvoiceFuelHeaderChangeDto | null {
  return change === null
    ? null
    : {
        percentage: change.percentage,
        header: toTextChangeDto(change.header),
        label: change.label === null ? null : toTextChangeDto(change.label),
      };
}

function toTextChangeDto(change: TextChange): InvoiceTextChangeDto {
  return { address: change.address, before: change.before, after: change.after };
}
