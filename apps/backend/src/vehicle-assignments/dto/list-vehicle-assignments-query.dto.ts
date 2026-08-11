import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsUUID } from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { toOptionalBoolean } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";

export class ListVehicleAssignmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: "uuid", description: "Filter by vehicle." })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Filter by driver." })
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional({
    description:
      "True returns only assignments in effect today: started on or before today and not yet ended.",
  })
  @Transform(toOptionalBoolean)
  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;

  @ApiPropertyOptional({
    description:
      "Start of a date range. Returns assignments whose period overlaps the range.",
    example: "2026-01-01",
  })
  @IsOptional()
  @IsCalendarDateString()
  from?: string;

  @ApiPropertyOptional({
    description: "End of the date range, inclusive.",
    example: "2026-12-31",
  })
  @IsOptional()
  @IsCalendarDateString()
  to?: string;
}
