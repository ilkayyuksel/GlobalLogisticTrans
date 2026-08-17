import { ApiPropertyOptional } from "@nestjs/swagger";
import { TripStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { trimToUndefined } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";
import {
  BOOKING_NUMBER_MAX_LENGTH,
  CONTAINER_NUMBER_MAX_LENGTH,
  DESTINATION_MAX_LENGTH,
  TERMINAL_MAX_LENGTH,
} from "./create-trip.dto";

import type {
  SortDirection,
  TripSortField,
} from "../trip.repository";

export const TRIP_SEARCH_MAX_LENGTH = 200;

/**
 * The accepted sort values, as arrays because `@IsIn` needs runtime values
 * while the repository's union types exist only at compile time. Kept next to
 * each other so a new sort field cannot be added to one and forgotten in the
 * other.
 */
export const TripSortFieldValues: readonly TripSortField[] = [
  "startTime",
  "endTime",
];

export const SortDirectionValues: readonly SortDirection[] = ["asc", "desc"];

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
    description:
      "Trips planned on exactly this day. Overrides the range filters.",
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
      "Exact booking number. Each Trip carries its own, including the two Trips of a Combination, so this returns a single Trip.",
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
    format: "uuid",
    description:
      "The TripGroup a Trip belongs to. Returns every leg of that Combination, which is the only way to list a group's members — a Trip response carries the group's id but not its siblings.",
  })
  @IsOptional()
  @IsUUID()
  tripGroupId?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Trips carrying this Custom Property. Filtered in the database through the assignment relation, so it narrows the whole result set rather than one page.",
  })
  @IsOptional()
  @IsUUID()
  customPropertyId?: string;

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
  @ApiPropertyOptional({
    enum: TripSortFieldValues,
    description:
      "Which time to order a day's Trips by. The planning date always stays the first ordering key, and a Vehicle's Trips stay together within a day — this chooses the order inside that grouping. Trips without the chosen time are listed last, in both directions.",
  })
  @IsOptional()
  @IsIn(TripSortFieldValues)
  sortBy?: TripSortField;

  @ApiPropertyOptional({
    enum: SortDirectionValues,
    description:
      "Direction of the time ordering. Applies to sortBy only: the date keeps its own order so the Day, Week and Month sections stay intact.",
  })
  @IsOptional()
  @IsIn(SortDirectionValues)
  sortDirection?: SortDirection;
}
