import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsUUID } from "class-validator";

/**
 * More than a route list holds, and few enough that one transaction stays short.
 * The configuration screen loads every route at once — neither list is
 * paginated — so "select all" can send a few hundred ids, never tens of thousands.
 */
export const BULK_REMOVE_MAX_IDS = 1000;

/**
 * Several route configurations to delete together.
 *
 * ── TWO LISTS, BECAUSE THEY ARE TWO KINDS OF RECORD ─────────────────────────
 * An ordinary route is one row; a Combination is a GROUP whose two legs only
 * ever go together. Naming the group, never a leg, is what makes deleting half a
 * Combination impossible to ask for — the same reason the single delete takes a
 * group id.
 */
export class BulkRemoveRouteConfigurationDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    maxItems: BULK_REMOVE_MAX_IDS,
    description: "Ordinary routes to delete. A Combination leg's id is refused: legs go with their group.",
  })
  @IsArray()
  @ArrayMaxSize(BULK_REMOVE_MAX_IDS)
  @IsUUID("4", { each: true })
  routeIds!: string[];

  @ApiProperty({
    type: [String],
    format: "uuid",
    maxItems: BULK_REMOVE_MAX_IDS,
    description: "Combination configurations to delete, each with both of its legs.",
  })
  @IsArray()
  @ArrayMaxSize(BULK_REMOVE_MAX_IDS)
  @IsUUID("4", { each: true })
  combinationGroupIds!: string[];
}

/** What one bulk deletion removed. */
export class BulkRemoveRouteConfigurationResultDto {
  @ApiProperty({ example: 12 })
  removedRoutes!: number;

  @ApiProperty({ example: 3 })
  removedCombinations!: number;
}
