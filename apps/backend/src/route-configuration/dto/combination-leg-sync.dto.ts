import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsUUID } from "class-validator";

/** A leg's place in its Combination: the outbound first, then the return. */
export const COMBINATION_LEG_POSITIONS = [1, 2] as const;

export type CombinationLegPosition = (typeof COMBINATION_LEG_POSITIONS)[number];

/** Which leg of which Combination is the source of a price sync. */
export class CombinationLegParamDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  combinationGroupId!: string;

  @ApiProperty({ enum: COMBINATION_LEG_POSITIONS, example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsIn(COMBINATION_LEG_POSITIONS)
  legPosition!: CombinationLegPosition;
}

/** The prices a sync copies: exactly what the source leg stores, nothing else. */
export class CombinationLegPricesDto {
  @ApiProperty({ example: "100.00" })
  tarief!: string;

  @ApiProperty({ example: "25.00" })
  toll!: string;

  @ApiProperty({ example: "10.00" })
  tunnel!: string;
}

/**
 * What a price sync of one leg reaches — or reached.
 *
 * The same answer for the preview and for the sync itself, so the number an
 * operator confirms and the number that was written are computed by one rule.
 */
export class CombinationLegSyncDto {
  @ApiProperty({ format: "uuid" })
  combinationGroupId!: string;

  @ApiProperty({ enum: COMBINATION_LEG_POSITIONS })
  legPosition!: CombinationLegPosition;

  @ApiProperty({ example: "PSA Quay 869" })
  departure!: string;

  @ApiProperty({ example: "GENT" })
  destination!: string;

  @ApiProperty({ type: CombinationLegPricesDto })
  prices!: CombinationLegPricesDto;

  @ApiProperty({
    type: [String],
    format: "uuid",
    description:
      "The OTHER Combinations whose leg in the same position runs the same From and To. Never the source itself, never an ordinary route, never the other position.",
  })
  targetCombinationGroupIds!: string[];
}
