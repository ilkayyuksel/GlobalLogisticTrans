import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, TransformFnParams } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

/**
 * Shared pagination input for every list endpoint.
 *
 * Lives in common/ because apps/backend/CLAUDE.md requires pagination on all
 * list endpoints — every future module extends this rather than redefining it.
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 25;
/** Caps the work a single request can ask the database to do. */
export const MAX_PAGE_SIZE = 200;

/**
 * Query parameters arrive as strings. Reading the raw value off the source
 * object keeps this independent of the ValidationPipe's implicit conversion,
 * and an unparseable value is left untouched so @IsInt reports it rather than
 * silently becoming NaN.
 */
function toPositiveInteger(fallback: number) {
  return ({ obj, key }: TransformFnParams): unknown => {
    const rawValue = (obj as Record<string, unknown>)[key];

    if (rawValue === undefined || rawValue === null || rawValue === "") {
      return fallback;
    }

    const parsed = Number(rawValue);

    return Number.isInteger(parsed) ? parsed : rawValue;
  };
}

export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: "One-based page number.",
    minimum: 1,
    default: DEFAULT_PAGE,
  })
  @Transform(toPositiveInteger(DEFAULT_PAGE))
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: "Number of items per page.",
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @Transform(toPositiveInteger(DEFAULT_PAGE_SIZE))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;
}
