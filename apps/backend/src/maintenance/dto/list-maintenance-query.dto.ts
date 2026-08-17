import { ApiPropertyOptional } from "@nestjs/swagger";
import { MaintenanceStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { toOptionalBoolean, trimToUndefined } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";

export const MAINTENANCE_SEARCH_MAX_LENGTH = 200;

export class ListMaintenanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: "uuid", description: "The Vehicle serviced." })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ enum: MaintenanceStatus })
  @IsOptional()
  @IsEnum(MaintenanceStatus)
  status?: MaintenanceStatus;

  @ApiPropertyOptional({
    description: "Maintenance on or after this day.",
    format: "date",
    example: "2026-01-01",
  })
  @IsOptional()
  @IsCalendarDateString()
  maintenanceDateFrom?: string;

  @ApiPropertyOptional({
    description: "Maintenance on or before this day.",
    format: "date",
    example: "2026-12-31",
  })
  @IsOptional()
  @IsCalendarDateString()
  maintenanceDateTo?: string;

  @ApiPropertyOptional({
    description:
      "Case-insensitive partial match across description, workshop, maintenance type and notes.",
    maxLength: MAINTENANCE_SEARCH_MAX_LENGTH,
    example: "banden",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(MAINTENANCE_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({
    description:
      "Only maintenance whose planned next date has arrived: nextMaintenanceDate is set and is not in the future, and the record is not CANCELLED. This is the whole of the due rule — a mileage-based due date CANNOT be evaluated, because nothing in this system knows a vehicle's current odometer reading.",
    example: true,
  })
  @Transform(toOptionalBoolean)
  @IsOptional()
  @IsBoolean()
  dueOnly?: boolean;
}
