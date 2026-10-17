import { ApiProperty } from "@nestjs/swagger";

import { toIsoDate } from "../../common/dates";
import type { AddedRow } from "../missing/added-rows";
import type { BlockedMissingTrip } from "../missing/missing-trips.service";
import { MONEY_DECIMAL_PLACES } from "../workbook/invoice-amounts";
import { InvoicePriceReliabilityDto, toPriceReliabilityDto } from "./invoice-row-details.dto";

/**
 * A finished, unpaid transport the invoice does not state, NOT added because an
 * unresolved line of the document could be that very transport.
 */
export class BlockedMissingTripDto {
  @ApiProperty({ format: "uuid" })
  tripId!: string;

  @ApiProperty({ format: "date" })
  planningDate!: string;

  @ApiProperty({ type: String, nullable: true })
  bookingNumber!: string | null;

  @ApiProperty({ type: String, nullable: true })
  containerNumber!: string | null;

  @ApiProperty({ type: [Number], description: "The unresolved rows that could be this transport." })
  blockingRowNumbers!: number[];
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
    type: InvoicePriceReliabilityDto,
    description: "Amounts are written only when the stored price can be relied on; otherwise the line is added empty of amounts and marked yellow.",
  })
  priceReliability!: InvoicePriceReliabilityDto;

  @ApiProperty({ example: "tar,EC 4220981", description: "The Remarks the added line gets; empty for none." })
  remarks!: string;

  @ApiProperty({ type: [String], description: "What could not be written in the customer's words." })
  remarkNotes!: string[];

  @ApiProperty({
    enum: ["startPoint", "endPoint"],
    nullable: true,
    description: "The end that carries the COMBINATION marker, for a leg of a group of exactly two.",
  })
  combinationEnd!: "startPoint" | "endPoint" | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 128,
    description:
      "The row the corrected workbook writes it on — directly above the totals row, which moves down. Null when the document's totals cannot take an added line.",
  })
  rowNumber!: number | null;
}

export function toBlockedMissingTripDto(blocked: BlockedMissingTrip): BlockedMissingTripDto {
  return {
    tripId: blocked.trip.id,
    planningDate: blocked.trip.planningDate ? toIsoDate(blocked.trip.planningDate) : "",
    bookingNumber: blocked.trip.bookingNumber,
    containerNumber: blocked.trip.containerNumber,
    blockingRowNumbers: [...blocked.blockingRowNumbers],
  };
}

export function toMissingTripDto(
  missing: AddedRow,
  rowNumber: number | null,
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
    priceReliability: toPriceReliabilityDto(missing.reliability),
    remarks: missing.remarks,
    remarkNotes: [...missing.remarkNotes],
    combinationEnd: missing.combinationEnd,
    rowNumber,
  };
}
