import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * The id of one Combination route configuration — the GROUP, never a leg.
 *
 * Named after the group on purpose: a caller acts on the pair, and accepting a
 * leg's id here would offer a way to reach half a Combination.
 */
export class CombinationRouteGroupIdParamDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  combinationGroupId!: string;
}
