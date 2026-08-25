import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

import { toOptionalBoolean, trimToNull } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";
import {
  CONTAINER_NUMBER_MAX_LENGTH,
  DESTINATION_MAX_LENGTH,
  DISTANCE_DECIMAL_PLACES,
  DISTANCE_KM_MAX,
  INTERNAL_NOTES_MAX_LENGTH,
  WAITING_TIME_MAX_MINUTES,
  toRawNumber,
} from "./create-trip.dto";

/**
 * Partial update of a Trip's MANUAL fields.
 *
 * The field list is taken from database_model.md §4.1 "Manual Fields": container
 * number, planning date, driver override, vehicle, waiting time, distance and
 * internal notes. Custom Property assignment is the eighth manual field and
 * belongs to a later phase.
 *
 * `executionDatetime` is included even though it is not on that list, because no
 * other actor can supply it — the parser cannot know when a transport was
 * actually carried out, so the administrator is its only possible source.
 *
 * Everything else is excluded on purpose:
 *   - `bookingNumber`, `originalPlanningDate` and `pdfDocumentId` are immutable.
 *   - `status` moves through the status, deletion and restoration endpoints.
 *   - `terminal` and `containerType` are parser-controlled.
 *   - `startTime` and `endTime` are parser-controlled, and changing them would
 *     silently re-open the Vehicle overlap question for an existing booking.
 *   - `parserMetadata` is never a manual field.
 *
 * THE DESTINATION IS THE EXCEPTION, AND ONLY ON A MANUAL TRIP. It is
 * parser-controlled exactly when there is a parser: a Trip created by hand has
 * no source document, so nothing else can ever correct a destination typed
 * wrongly — it was write-once, and a Trip planned to the wrong city stayed
 * planned to the wrong city. The service refuses it on an IMPORTED Trip, where
 * the document remains the authority; see `DestinationNotEditableException`.
 *
 * `isLooseTrip` is accepted on any Trip: it is the operator's own
 * classification, no parser ever writes it, and a box ticked by mistake has to
 * be untickable.
 *
 * The global ValidationPipe runs with forbidNonWhitelisted, so sending any of
 * them is rejected with 400 rather than ignored.
 */
export class UpdateTripDto {
  @ApiPropertyOptional({
    description:
      "Entered manually once the driver reports it. Send null to clear.",
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
    description:
      "Moves the Trip to another day. The original planning date is preserved separately and never changes.",
    format: "date",
    example: "2026-08-18",
  })
  @IsOptional()
  @IsCalendarDateString()
  planningDate?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Assigned Vehicle. Must be active when it changes. Send null to unassign.",
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Driver override for this Trip only. Must be active when it changes. Send null to fall back to the Vehicle's assignment.",
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  driverId?: string | null;

  @ApiPropertyOptional({
    description: "Waiting time in minutes. Send null to clear.",
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
    description: "Distance in kilometres. Send null to clear.",
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
      "When the transport was actually carried out. Send null to clear.",
    format: "date-time",
    nullable: true,
    example: "2026-08-17T16:45:00.000Z",
  })
  @IsOptional()
  @IsDateString()
  executionDatetime?: string | null;

  @ApiPropertyOptional({
    description: "Administrator notes. Send null to clear.",
    maxLength: INTERNAL_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(INTERNAL_NOTES_MAX_LENGTH)
  internalNotes?: string | null;

  @ApiPropertyOptional({
    description:
      "Destination city. Accepted only on a Trip created by hand; on an imported Trip the document is the authority and this is refused. Send null to clear.",
    maxLength: DESTINATION_MAX_LENGTH,
    nullable: true,
    example: "Bousbecque",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(DESTINATION_MAX_LENGTH)
  destinationCity?: string | null;

  @ApiPropertyOptional({
    description:
      "Destination country. Same rule as the city: manual Trips only. Send null to clear.",
    maxLength: DESTINATION_MAX_LENGTH,
    nullable: true,
    example: "France",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(DESTINATION_MAX_LENGTH)
  destinationCountry?: string | null;

  @ApiPropertyOptional({
    description:
      "LOSRIT: a loose trip. The operator's own classification, independent of the lifecycle and never written by a document.",
    example: true,
  })
  /*
   * The RAW value, because the pipe's implicit conversion would otherwise turn
   * any non-empty string into `true` — a typo would silently classify a Trip as
   * LOSRIT. `toOptionalBoolean` passes anything it does not recognise straight
   * through so @IsBoolean can reject it.
   */
  @Transform(toOptionalBoolean)
  @IsOptional()
  @IsBoolean()
  isLooseTrip?: boolean;
}
