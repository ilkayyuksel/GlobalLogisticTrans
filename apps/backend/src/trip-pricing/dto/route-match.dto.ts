import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CombinationMatchOutcome, RouteMatchMethod } from "@prisma/client";

import { MONEY_DECIMAL_PLACES } from "../../common/dto/money";
import type { RouteMatchView } from "../route-match-view";

/**
 * Which configured route a stored price came from — as the calculation
 * recorded it, never matched again for display. See `route-match-view.ts`.
 */
export class RouteMatchLegDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: "1 or 2 for a Combination leg; null for an ordinary route.",
  })
  legPosition!: number | null;

  @ApiProperty({ description: "True for the leg that priced THIS Trip." })
  isPricedLeg!: boolean;

  @ApiProperty({
    format: "uuid",
    description: "The route configuration matched. It may since have been changed or removed.",
  })
  routePricingId!: string;

  @ApiProperty({ description: "The configured departure, as it read when the price was calculated." })
  departure!: string;

  @ApiProperty({ description: "The configured destination, as it read when the price was calculated." })
  destination!: string;

  @ApiProperty({ enum: RouteMatchMethod, enumName: "RouteMatchMethod" })
  method!: RouteMatchMethod;
}

export class AppliedOverStDto {
  @ApiProperty({ description: "Whether the stored calculation added Over ST." })
  applied!: boolean;

  @ApiProperty({ type: String, example: "40.00" })
  tarief!: string;

  @ApiProperty({ type: String, example: "10.00" })
  toll!: string;

  @ApiProperty({ type: String, example: "0.00" })
  tunnel!: string;

  @ApiProperty({
    type: String,
    description: "The Over ST surcharge (PRICING.OVER_ST_SURCHARGE) on Leg 2's Tarief.",
    example: "70.00",
  })
  surcharge!: string;
}

export class RouteMatchDto {
  @ApiPropertyOptional({
    enum: RouteMatchMethod,
    enumName: "RouteMatchMethod",
    nullable: true,
    description:
      "How the route was matched. NOT_FOUND / AMBIGUOUS: no reliable route, the route components are zero. Null: an older calculation that did not record its match.",
  })
  method!: RouteMatchMethod | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  routePricingId!: string | null;

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description: "The Combination whose pair of legs priced the Trip, or null.",
  })
  combinationRouteGroupId!: string | null;

  @ApiPropertyOptional({
    enum: CombinationMatchOutcome,
    enumName: "CombinationMatchOutcome",
    nullable: true,
    description:
      "For a Trip in a group: MATCHED when its pair of roads named one configured Combination, otherwise why it was priced on ordinary routes (NO_PAIR, LEG_NOT_IDENTIFIED, PAIR_NOT_CONFIGURED, AMBIGUOUS). Null for a Trip in no group, or a calculation that did not record it.",
  })
  combinationMatch!: CombinationMatchOutcome | null;

  @ApiProperty({
    type: [RouteMatchLegDto],
    description:
      "One leg for an ordinary route, both legs of the pair for a Combination, none when nothing matched or nothing was recorded.",
  })
  legs!: RouteMatchLegDto[];

  @ApiPropertyOptional({
    type: AppliedOverStDto,
    nullable: true,
    description: "Null unless a Combination priced the Trip.",
  })
  overSt!: AppliedOverStDto | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      "Whether the route price (or, for a Combination, the Combination) that priced the Trip has been checked on the Routeprijzen page. Read live, so it follows that page's mark. Null when nothing was priced on a route, when the configuration no longer exists, or when this read does not carry it.",
  })
  reviewed!: boolean | null;
}

export function toRouteMatchDto(view: RouteMatchView): RouteMatchDto {
  return {
    method: view.method,
    routePricingId: view.routePricingId,
    combinationRouteGroupId: view.combinationRouteGroupId,
    combinationMatch: view.combinationMatch,
    legs: view.legs.map((leg) => ({ ...leg })),
    overSt: view.overSt
      ? {
          applied: view.overSt.applied,
          tarief: view.overSt.tarief.toFixed(MONEY_DECIMAL_PLACES),
          toll: view.overSt.toll.toFixed(MONEY_DECIMAL_PLACES),
          tunnel: view.overSt.tunnel.toFixed(MONEY_DECIMAL_PLACES),
          surcharge: view.overSt.surcharge.toFixed(MONEY_DECIMAL_PLACES),
        }
      : null,
    reviewed: view.reviewed,
  };
}
