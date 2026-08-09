import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import {
  toOptionalBoolean,
  trimToUndefined,
} from "../../common/dto/transforms";

export const VEHICLE_SEARCH_MAX_LENGTH = 200;

export class ListVehiclesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      "Filter by active state. Omit to return both active and inactive vehicles.",
  })
  @Transform(toOptionalBoolean)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      "Case-insensitive partial match across licence plate, brand and model.",
    maxLength: VEHICLE_SEARCH_MAX_LENGTH,
    example: "volvo",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(VEHICLE_SEARCH_MAX_LENGTH)
  search?: string;
}
