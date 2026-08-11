import { ApiPropertyOptional } from "@nestjs/swagger";
import { TripStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { trimToUndefined } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";
import {
  BOOKING_NUMBER_MAX_LENGTH,
  CONTAINER_NUMBER_MAX_LENGTH,
  DESTINATION_MAX_LENGTH,
  TERMINAL_MAX_LENGTH,
} from "./create-trip.dto";

export const TRIP_SEARCH_MAX_LENGTH = 200;

/**
 * Filters for the Trip list.
 *
 * A Trip has no "route" column: the route of a transport is expressed by its
 * terminal and its destination, so those are exposed as separate filters rather
 * than inventing a combined field.
 */
export class ListTripsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: TripStatus,
    description:
      "Exact status. When omitted, DELETED Trips are hidden — they must not appear in normal planning views. Pass status=DELETED to list them.",
  })
  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus;

  @ApiPropertyOptional({
    description: "Trips planned on exactly this day. Overrides the range filters.",
    format: "date",
    example: "2026-08-17",
  })
  @IsOptional()
  @IsCalendarDateString()
  planningDate?: string;

  @ApiPropertyOptional({
    description:
      "Start of a planning-date range, inclusive. Serves the daily and weekly planning views.",
    format: "date",
    example: "2026-08-17",
  })
  @IsOptional()
  @IsCalendarDateString()
  planningDateFrom?: string;

  @ApiPropertyOptional({
    description: "End of a planning-date range, inclusive.",
    format: "date",
    example: "2026-08-23",
  })
  @IsOptional()
  @IsCalendarDateString()
  planningDateTo?: string;

  @ApiPropertyOptional({
    description:
      "Exact booking number. Returns every Trip of a Combination, since they share one booking number.",
    maxLength: BOOKING_NUMBER_MAX_LENGTH,
    example: "BK-2026-0042",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(BOOKING_NUMBER_MAX_LENGTH)
  bookingNumber?: string;

  @ApiPropertyOptional({
    description: "Exact container number.",
    maxLength: CONTAINER_NUMBER_MAX_LENGTH,
    example: "MSKU1234567",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(CONTAINER_NUMBER_MAX_LENGTH)
  containerNumber?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Filters on the Driver OVERRIDE column only. Trips whose Driver is derived from the Vehicle's assignment are not matched — that resolution is not part of this phase.",
  })
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Assigned Vehicle." })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({
    description: "Exact terminal.",
    maxLength: TERMINAL_MAX_LENGTH,
    example: "Antwerp Gateway",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(TERMINAL_MAX_LENGTH)
  terminal?: string;

  @ApiPropertyOptional({
    description: "Exact destination city.",
    maxLength: DESTINATION_MAX_LENGTH,
    example: "Bousbecque",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(DESTINATION_MAX_LENGTH)
  destinationCity?: string;

  @ApiPropertyOptional({
    description: "Exact destination country.",
    maxLength: DESTINATION_MAX_LENGTH,
    example: "France",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(DESTINATION_MAX_LENGTH)
  destinationCountry?: string;

  @ApiPropertyOptional({
    description:
      "Case-insensitive partial match across booking number, container number, terminal, destination city and destination country.",
    maxLength: TRIP_SEARCH_MAX_LENGTH,
    example: "rotterdam",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(TRIP_SEARCH_MAX_LENGTH)
  search?: string;
}
