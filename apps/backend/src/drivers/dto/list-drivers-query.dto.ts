import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import {
  toOptionalBoolean,
  trimToUndefined,
} from "../../common/dto/transforms";

export const DRIVER_SEARCH_MAX_LENGTH = 200;

export class ListDriversQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      "Filter by active state. Omit to return both active and inactive drivers.",
  })
  @Transform(toOptionalBoolean)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: "Case-insensitive partial match on the driver name.",
    maxLength: DRIVER_SEARCH_MAX_LENGTH,
    example: "peeters",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(DRIVER_SEARCH_MAX_LENGTH)
  search?: string;
}
