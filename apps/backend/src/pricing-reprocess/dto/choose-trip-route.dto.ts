import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsUUID, ValidateIf } from "class-validator";

import type { RouteChoiceRequest } from "../../pricing-engine/manual-route-selection.service";

/**
 * The route an operator chose for a Trip whose automatic match is unusable.
 *
 * EXACTLY ONE of the two ids: an ordinary route for a Trip in no group, or a
 * Combination for a grouped one. `legPosition` names this Trip's leg, and is
 * only needed when the backend answered 422 because the roads do not say.
 */
export class ChooseTripRouteDto {
  @ApiPropertyOptional({ format: "uuid", description: "An ordinary route, for a Trip in no group." })
  @ValidateIf((dto: ChooseTripRouteDto) => dto.combinationRouteGroupId === undefined)
  @IsUUID()
  routePricingId?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "A Combination, for a grouped Trip. Its partner leg is given the other leg automatically.",
  })
  @ValidateIf((dto: ChooseTripRouteDto) => dto.routePricingId === undefined)
  @IsUUID()
  combinationRouteGroupId?: string;

  @ApiPropertyOptional({
    enum: [1, 2],
    description: "This Trip's leg of the Combination, when the roads do not decide it.",
  })
  @IsOptional()
  @IsIn([1, 2])
  legPosition?: 1 | 2;
}

/** The Trips priced on the choice: this one, and for a Combination its partner leg. */
export class ChooseTripRouteResultDto {
  @ApiProperty({ type: [String], format: "uuid" })
  pricedTripIds!: string[];
}

/** The request as the service reads it; null when both ids or neither were sent. */
export function toRouteChoiceRequest(dto: ChooseTripRouteDto): RouteChoiceRequest | null {
  if ((dto.routePricingId === undefined) === (dto.combinationRouteGroupId === undefined)) {
    return null;
  }

  return dto.routePricingId !== undefined
    ? { kind: "NORMAL", routePricingId: dto.routePricingId }
    : { kind: "COMBINATION", combinationRouteGroupId: dto.combinationRouteGroupId as string, legPosition: dto.legPosition };
}
