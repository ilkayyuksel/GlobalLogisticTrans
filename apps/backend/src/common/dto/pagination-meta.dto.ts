import { ApiProperty } from "@nestjs/swagger";

/**
 * Paging information returned alongside every list result.
 *
 * `totalPages` is derived rather than stored so it can never disagree with
 * `totalItems` and `pageSize`.
 */
export class PaginationMetaDto {
  @ApiProperty({ description: "One-based page number.", example: 1 })
  page!: number;

  @ApiProperty({ description: "Requested page size.", example: 25 })
  pageSize!: number;

  @ApiProperty({ description: "Total rows matching the filter.", example: 42 })
  totalItems!: number;

  @ApiProperty({ description: "Total pages available.", example: 2 })
  totalPages!: number;
}

export function buildPaginationMeta(
  totalItems: number,
  page: number,
  pageSize: number,
): PaginationMetaDto {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize),
  };
}
