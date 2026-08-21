import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { CostConfirmationDto } from "../../cost-confirmations/dto/cost-confirmation-response.dto";
import { Trip, TripDirection, TripStatus } from "@prisma/client";

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
/**
 * Just enough of a Vehicle to put it on a screen.
 *
 * A summary rather than the whole Vehicle: a planning view needs to identify
 * the truck and colour its row, and embedding brand, model, year and notes in
 * every Trip of every page would multiply the payload for data nobody reads
 * there. The full record stays one request away at /vehicles/{id}.
 */
export class TripVehicleSummaryDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "1-ABC-123" })
  licensePlate!: string;

  /** The Vehicle's own colour, so a board can keep one truck visually stable. */
  @ApiProperty({ example: "#2563EB" })
  displayColor!: string;

  @ApiProperty({
    description:
      "False when the Vehicle has since been deactivated. The Trip keeps it.",
  })
  isActive!: boolean;
}

/** How a Trip's driver was arrived at. */
export enum EffectiveDriverSource {
  /** trip.driver_id — an explicit override for this Trip alone. */
  Override = "OVERRIDE",
  /** The VehicleAssignment covering the Trip's planning date. */
  VehicleAssignment = "VEHICLE_ASSIGNMENT",
}

/**
 * The driver actually responsible for a Trip.
 *
 * Resolved by the Backend, because the rule is a business rule: a Trip's
 * `driverId` is only an OVERRIDE, and when it is absent the driver comes from
 * the VehicleAssignment in effect on the Trip's planning date. A client that
 * worked this out for itself would be running that rule in a second place, and
 * would get it wrong the moment assignments have gaps or boundaries.
 *
 * `source` is included because the distinction is operationally meaningful: an
 * override was chosen deliberately for this Trip, an assignment is the standing
 * arrangement, and a planner treats the two differently.
 */
export class EffectiveDriverDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Jan Peeters" })
  name!: string;

  @ApiProperty({
    description:
      "False when the Driver has since been deactivated. Deactivation does not rewrite who drove a past Trip.",
  })
  isActive!: boolean;

  @ApiProperty({ enum: EffectiveDriverSource })
  source!: EffectiveDriverSource;
}

/**
 * A Custom Property as a Trip carries it.
 *
 * Name and active state only: a list needs to say "TAR, Flat" and to mark one
 * that has since been deactivated. The configured price is deliberately absent
 * — what a property contributed to THIS Trip is a line in its pricing snapshot,
 * and showing a configuration amount beside a Trip would invite reading it as
 * the charge.
 */
export class TripCustomPropertySummaryDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "TAR" })
  name!: string;

  @ApiProperty({
    description:
      "False when the property was deactivated after it was assigned. The assignment stands.",
  })
  isActive!: boolean;
}

/**
 * The resolved companions of a Trip, supplied by the service.
 *
 * A required parameter of `toTripResponse` rather than an optional one on
 * purpose: if it could be omitted, a caller that forgot would return
 * `effectiveDriver: null`, which a client cannot tell apart from "this Trip
 * genuinely has no driver". Making it required turns that mistake into a
 * compile error.
 */
export interface TripPlanningData {
  vehicle: TripVehicleSummaryDto | null;
  effectiveDriver: EffectiveDriverDto | null;
  /** In the properties' configured display order. Empty when none are assigned. */
  customProperties: TripCustomPropertySummaryDto[];
  latestUpdate: LatestTripUpdateDto | null;
  costConfirmation: CostConfirmationDto | null;
}

/**
 * What the most recent APPLIED update document did to this Trip.
 *
 * Derived, never stored: it is the newest `UPDATE_APPLIED` event, read from the
 * audit trail. A cancellation does not replace it and neither does the original
 * import, so a cancelled Trip still reports the last update it received before
 * it was cancelled.
 *
 * Null when no update has ever been applied. `changedFields` is EMPTY when an
 * update arrived and changed nothing, which is a different fact and stays
 * distinguishable.
 */
export class LatestTripUpdateDto {
  @ApiProperty({ format: "date-time" })
  occurredAt!: Date;

  @ApiProperty({
    type: [String],
    description:
      "The parser-controlled fields that update moved. Empty when it moved none.",
    example: ["containerNumber", "originalPlanningDate"],
  })
  changedFields!: string[];

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description: "The UPDATE document that caused it, for viewing or download.",
  })
  pdfDocumentId!: string | null;
}

export class TripResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "The PDF this Trip originates from, and immutable when there is one. Null for a Trip created by hand, which has no source document.",
  })
  pdfDocumentId!: string | null;

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

  @ApiProperty({
    type: [TripCustomPropertySummaryDto],
    description:
      "The Custom Properties assigned to this Trip, embedded so a list needs no request per row.",
  })
  customProperties!: TripCustomPropertySummaryDto[];

  @ApiProperty({ enum: TripStatus })
  status!: TripStatus;

  @ApiPropertyOptional({
    enum: TripDirection,
    nullable: true,
    description:
      "Which half of the transport this Trip is, as the transport order stated it: COLLECTION fetches a container, DELIVERY brings one. Null on a Trip created by hand, and on Trips imported before this was recorded.",
  })
  direction!: TripDirection | null;

  @ApiPropertyOptional({
    nullable: true,
    example: "BK-2026-0042",
    description:
      "From the transport order. Null on a manual Trip whose booking number is not known yet.",
  })
  bookingNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "MSKU1234567" })
  containerNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "45PH" })
  containerType!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "Antwerp Gateway" })
  terminal!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "Bousbecque" })
  destinationCity!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "France" })
  destinationCountry!: string | null;

  @ApiPropertyOptional({
    type: String,
    format: "date",
    nullable: true,
    description:
      "Immutable date extracted at import. Null on a manual Trip, which was never imported.",
    example: "2026-08-17",
  })
  originalPlanningDate!: string | null;

  @ApiPropertyOptional({
    type: String,
    format: "date",
    nullable: true,
    example: "2026-08-18",
    description:
      "The day this Trip is planned for. Null when it has not been scheduled yet, which also means no driver can be resolved for it.",
  })
  planningDate!: string | null;

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

  @ApiPropertyOptional({
    type: TripVehicleSummaryDto,
    nullable: true,
    description:
      "The assigned Vehicle, summarised. Null when none is assigned. Embedded so a planning view does not need one request per Trip.",
  })
  vehicle!: TripVehicleSummaryDto | null;

  @ApiPropertyOptional({
    type: EffectiveDriverDto,
    nullable: true,
    description:
      "Who is actually driving: the override if one is set, otherwise the Driver from the VehicleAssignment covering planningDate. Null when neither exists.",
  })
  effectiveDriver!: EffectiveDriverDto | null;

  @ApiPropertyOptional({
    type: LatestTripUpdateDto,
    nullable: true,
    description:
      "The most recent applied UPDATE document, or null when there has been none. Derived from the audit trail; there is no UPDATED status.",
  })
  latestUpdate!: LatestTripUpdateDto | null;

  @ApiPropertyOptional({
    type: CostConfirmationDto,
    nullable: true,
    description:
      "The cost Eucon confirmed for this Trip, or null. A Trip has at most ONE. Read-only, and never merged with the waiting time an operator entered: the minutes and the confirmed amount are different facts.",
  })
  costConfirmation!: CostConfirmationDto | null;

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

export function toTripResponse(
  trip: Trip,
  planning: TripPlanningData,
): TripResponseDto {
  return {
    id: trip.id,
    pdfDocumentId: trip.pdfDocumentId,
    tripGroupId: trip.tripGroupId,
    vehicleId: trip.vehicleId,
    driverId: trip.driverId,
    status: trip.status,
    direction: trip.direction,
    bookingNumber: trip.bookingNumber,
    containerNumber: trip.containerNumber,
    containerType: trip.containerType,
    terminal: trip.terminal,
    destinationCity: trip.destinationCity,
    destinationCountry: trip.destinationCountry,
    originalPlanningDate:
      trip.originalPlanningDate === null
        ? null
        : toIsoDate(trip.originalPlanningDate),
    planningDate:
      trip.planningDate === null ? null : toIsoDate(trip.planningDate),
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
    vehicle: planning.vehicle,
    effectiveDriver: planning.effectiveDriver,
    latestUpdate: planning.latestUpdate,
    costConfirmation: planning.costConfirmation,
    customProperties: planning.customProperties,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
}
