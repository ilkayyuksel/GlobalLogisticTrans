import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { toOptionalBoolean, trimToUndefined } from "../../common/dto/transforms";

export const ROUTE_COST_SEARCH_MAX_LENGTH = 200;

export class ListRouteCostsQueryDto extends PaginationQueryDto {
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
      "Filter to one pricing component, for example every configured toll.",
    format: "uuid",
  })
  @IsOptional()
  @IsUUID()
  pricingComponentId?: string;

  @ApiPropertyOptional({
    description:
      "Case-insensitive partial match across departure and destination.",
    maxLength: ROUTE_COST_SEARCH_MAX_LENGTH,
    example: "rotterdam",
  })
  @Transform(trimToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(ROUTE_COST_SEARCH_MAX_LENGTH)
  search?: string;
}
