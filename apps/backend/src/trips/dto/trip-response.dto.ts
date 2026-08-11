import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Trip, TripStatus } from "@prisma/client";

import { toIsoDate } from "../../common/dates";
import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";
import { toClockTime } from "../../common/time-of-day";
import { DISTANCE_DECIMAL_PLACES } from "./create-trip.dto";

/**
 * Public shape of a Trip.
 *
 * Temporal columns are rendered in the form they were stored in rather than as
 * full timestamps: DATE columns as "YYYY-MM-DD" and TIME columns as "HH:MM:SS".
 * Serialising them as Date would attach a timezone the column never had, and a
 * client east or west of UTC would then read back a different day or hour.
 *
 * `distanceKm` is serialised as a fixed-precision string, not a JSON number.
 * The column is NUMERIC(8,2); rendering it as a float would reintroduce the
 * binary rounding the decimal type exists to avoid, which matters because
 * Distance-Based Pricing will read this value.
 *
 * `parserMetadata` is deliberately not exposed. It is diagnostics-only, no
 * business decision may read from it, and this phase has no parser to fill it.
 */
export class TripResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({
    format: "uuid",
    description: "The PDF this Trip originates from. Immutable.",
  })
  pdfDocumentId!: string;

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "Set when the Trip is part of a Combination. Grouping is not managed through this phase.",
  })
  tripGroupId!: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  vehicleId!: string | null;

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "Driver override. Null means the Driver is resolved through the Vehicle's assignment.",
  })
  driverId!: string | null;

  @ApiProperty({ enum: TripStatus })
  status!: TripStatus;

  @ApiProperty({ example: "BK-2026-0042" })
  bookingNumber!: string;

  @ApiPropertyOptional({ nullable: true, example: "MSKU1234567" })
  containerNumber!: string | null;

  @ApiProperty({ example: "45PH" })
  containerType!: string;

  @ApiPropertyOptional({ nullable: true, example: "Antwerp Gateway" })
  terminal!: string | null;

  @ApiProperty({ example: "Bousbecque" })
  destinationCity!: string;

  @ApiProperty({ example: "France" })
  destinationCountry!: string;

  @ApiProperty({
    type: String,
    format: "date",
    description: "Immutable date extracted at import.",
    example: "2026-08-17",
  })
  originalPlanningDate!: string;

  @ApiProperty({ type: String, format: "date", example: "2026-08-18" })
  planningDate!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: "08:00:00" })
  startTime!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: "12:30:00" })
  endTime!: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  executionDatetime!: Date | null;

  @ApiPropertyOptional({ nullable: true, example: 45 })
  waitingTimeMinutes!: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Kilometres, always with two decimals.",
    example: "132.50",
  })
  distanceKm!: string | null;

  @ApiPropertyOptional({ nullable: true })
  internalNotes!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

/** Concrete type rather than a generic, so the OpenAPI schema stays accurate. */
export class PaginatedTripsDto {
  @ApiProperty({ type: [TripResponseDto] })
  items!: TripResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export function toTripResponse(trip: Trip): TripResponseDto {
  return {
    id: trip.id,
    pdfDocumentId: trip.pdfDocumentId,
    tripGroupId: trip.tripGroupId,
    vehicleId: trip.vehicleId,
    driverId: trip.driverId,
    status: trip.status,
    bookingNumber: trip.bookingNumber,
    containerNumber: trip.containerNumber,
    containerType: trip.containerType,
    terminal: trip.terminal,
    destinationCity: trip.destinationCity,
    destinationCountry: trip.destinationCountry,
    originalPlanningDate: toIsoDate(trip.originalPlanningDate),
    planningDate: toIsoDate(trip.planningDate),
    startTime: trip.startTime === null ? null : toClockTime(trip.startTime),
    endTime: trip.endTime === null ? null : toClockTime(trip.endTime),
    executionDatetime: trip.executionDatetime,
    waitingTimeMinutes: trip.waitingTimeMinutes,
    // Explicit null check, not truthiness: a distance of exactly 0 is a value,
    // not an absent one.
    distanceKm:
      trip.distanceKm === null
        ? null
        : trip.distanceKm.toFixed(DISTANCE_DECIMAL_PLACES),
    internalNotes: trip.internalNotes,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
}
