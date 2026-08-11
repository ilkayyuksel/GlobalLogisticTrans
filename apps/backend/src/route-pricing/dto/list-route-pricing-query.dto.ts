import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import {
  toOptionalBoolean,
  trimToUndefined,
} from "../../common/dto/transforms";

export const ROUTE_SEARCH_MAX_LENGTH = 200;

export class ListRoutePricingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      "Filter by active state. Omit to return both active and inactive records.",
  })
  @Transform(toOptionalBoolean)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      "Case-insensitive partial match across route name, departure and destination.",
    maxLength: ROUTE_SEARCH_MAX_LENGTH,
    example: "rotterdam",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(ROUTE_SEARCH_MAX_LENGTH)
  search?: string;
}
