import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import {
  toOptionalBoolean,
  trimToUndefined,
} from "../../common/dto/transforms";

export const PROPERTY_SEARCH_MAX_LENGTH = 200;

export class ListCustomPropertiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      "Filter by active state. Omit to return both active and inactive properties.",
  })
  @Transform(toOptionalBoolean)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: "Case-insensitive partial match on name and description.",
    maxLength: PROPERTY_SEARCH_MAX_LENGTH,
    example: "niklaas",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(PROPERTY_SEARCH_MAX_LENGTH)
  search?: string;
}
