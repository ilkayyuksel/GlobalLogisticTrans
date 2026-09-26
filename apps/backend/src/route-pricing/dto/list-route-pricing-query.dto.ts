import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { trimToUndefined } from "../../common/dto/transforms";

export const ROUTE_SEARCH_MAX_LENGTH = 200;

/**
 * There is no state to filter on.
 *
 * A route price exists or it does not: the active flag is gone, and with it the
 * filter that separated the two kinds of row.
 */
export class ListRoutePricingQueryDto extends PaginationQueryDto {
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
