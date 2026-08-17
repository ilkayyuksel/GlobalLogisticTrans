import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import { rawValueOf, trimToNull } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";
import { IsClockTimeString } from "../../common/validators/is-clock-time-string.validator";

export const BOOKING_NUMBER_MAX_LENGTH = 100;
export const CONTAINER_NUMBER_MAX_LENGTH = 100;
export const CONTAINER_TYPE_MAX_LENGTH = 50;
export const TERMINAL_MAX_LENGTH = 200;
export const DESTINATION_MAX_LENGTH = 200;
export const INTERNAL_NOTES_MAX_LENGTH = 2000;

/** A planned wait is measured in minutes and cannot exceed a long working day. */
export const WAITING_TIME_MAX_MINUTES = 10_080;

/** NUMERIC(8,2) holds six integer digits and two decimals. */
export const DISTANCE_KM_MAX = 999_999.99;
export const DISTANCE_DECIMAL_PLACES = 2;

/**
 * Reads the raw request value so the pipe's implicit conversion cannot turn a
 * string or boolean into a number behind the validator's back — `"abc"` must be
 * rejected, not silently coerced.
 */
export function toRawNumber(params: Parameters<typeof rawValueOf>[0]): unknown {
  return rawValueOf(params);
}

/**
 * Body for creating a Trip by hand.
 *
 * `status` is absent on purpose: every Trip starts OPEN and moves through the
 * status endpoint, so the lifecycle has one entry point.
 *
 * `parserMetadata` is absent on purpose: it is parser-controlled, replaced on
 * every reprocessing and never a manual field.
 *
 * `tripGroupId` is absent on purpose: grouping is created from a Combination
 * PDF and carries cross-row invariants that this phase does not implement.
 */
export class CreateTripDto {
  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "The PDF this Trip originates from. Required for an imported Trip and omitted for one created by hand, which has no source document. When supplied, the document must exist.",
  })
  @IsOptional()
  @IsUUID()
  pdfDocumentId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Primary business identifier from the transport order. May be absent on a Trip entered by hand before its paperwork arrives; uniqueness is enforced only among the Trips that have one.",
    maxLength: BOOKING_NUMBER_MAX_LENGTH,
    example: "BK-2026-0042",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(BOOKING_NUMBER_MAX_LENGTH)
  bookingNumber?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Container type code.",
    maxLength: CONTAINER_TYPE_MAX_LENGTH,
    example: "45PH",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CONTAINER_TYPE_MAX_LENGTH)
  containerType?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Destination city. Street level is not stored.",
    maxLength: DESTINATION_MAX_LENGTH,
    example: "Bousbecque",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(DESTINATION_MAX_LENGTH)
  destinationCity?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Destination country.",
    maxLength: DESTINATION_MAX_LENGTH,
    example: "France",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(DESTINATION_MAX_LENGTH)
  destinationCountry?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "The originally planned date. Immutable: it preserves what was planned before any administrator moved the Trip. Defaults to the planning date when one is given, because that IS what was originally planned; null when neither is.",
    format: "date",
    example: "2026-08-17",
  })
  @IsOptional()
  @IsCalendarDateString()
  originalPlanningDate?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "The date the Trip is currently planned on. May be moved later, and may be absent on a Trip that has not been scheduled yet — in which case no driver can be resolved for it either.",
    format: "date",
    example: "2026-08-17",
  })
  @IsOptional()
  @IsCalendarDateString()
  planningDate?: string | null;

  @ApiPropertyOptional({
    description: "Terminal the container is collected from or returned to.",
    maxLength: TERMINAL_MAX_LENGTH,
    nullable: true,
    example: "Antwerp Gateway",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(TERMINAL_MAX_LENGTH)
  terminal?: string | null;

  @ApiPropertyOptional({
    description:
      "Often unknown on a Loading until the driver reports it, so it may be supplied later.",
    maxLength: CONTAINER_NUMBER_MAX_LENGTH,
    nullable: true,
    example: "MSKU1234567",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(CONTAINER_NUMBER_MAX_LENGTH)
  containerNumber?: string | null;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Assigned Vehicle. Must be active at the time of assignment.",
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Driver OVERRIDE for this Trip only. When omitted, the Driver is resolved through the Vehicle's assignment. Must be active at the time of assignment.",
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  driverId?: string | null;

  @ApiPropertyOptional({
    description:
      "Planned start of the transport. Together with endTime it detects a Vehicle being double-booked.",
    nullable: true,
    example: "08:00",
  })
  @IsOptional()
  @IsClockTimeString()
  startTime?: string | null;

  @ApiPropertyOptional({
    description: "Planned end of the transport.",
    nullable: true,
    example: "12:30",
  })
  @IsOptional()
  @IsClockTimeString()
  endTime?: string | null;

  @ApiPropertyOptional({
    description:
      "When the transport was actually carried out. May differ from the planning date.",
    format: "date-time",
    nullable: true,
    example: "2026-08-17T16:45:00.000Z",
  })
  @IsOptional()
  @IsDateString()
  executionDatetime?: string | null;

  @ApiPropertyOptional({
    description: "Waiting time in minutes. Contributes to pricing.",
    minimum: 0,
    maximum: WAITING_TIME_MAX_MINUTES,
    nullable: true,
    example: 45,
  })
  @Transform(toRawNumber)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(WAITING_TIME_MAX_MINUTES)
  waitingTimeMinutes?: number | null;

  @ApiPropertyOptional({
    description:
      "Distance in kilometres. Used by Distance-Based Pricing. Stored as NUMERIC(8,2); at most two decimals.",
    minimum: 0,
    maximum: DISTANCE_KM_MAX,
    nullable: true,
    example: 132.5,
  })
  @Transform(toRawNumber)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: DISTANCE_DECIMAL_PLACES })
  @Min(0)
  @Max(DISTANCE_KM_MAX)
  distanceKm?: number | null;

  @ApiPropertyOptional({
    description:
      "Administrator notes. Never affect pricing or parser behaviour; intended for internal communication.",
    maxLength: INTERNAL_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(INTERNAL_NOTES_MAX_LENGTH)
  internalNotes?: string | null;
}
