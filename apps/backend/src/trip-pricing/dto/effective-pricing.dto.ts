import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

import { MONEY_DECIMAL_PLACES } from "../../common/dto/money";
import {
  EffectivePricing,
  PricingAmountSource,
  type EffectiveAmount,
} from "../effective-pricing";

/**
 * What a Trip is worth, as a screen reads it.
 *
 * Every amount is a fixed-precision string rather than a JSON number, for the
 * same reason `TripPricingResponseDto.totalPrice` is: the columns are
 * NUMERIC(12,2), and a float would reintroduce exactly the rounding the decimal
 * type exists to prevent.
 *
 * The eight named amounts are the Ritten pricing columns. `components` carries
 * the per-component detail underneath them, which is what lets the UI mark an
 * amount as manually corrected and offer to withdraw the correction — without
 * it the screen could show a figure but not explain where it came from.
 */
export class EffectivePricingComponentDto {
  @ApiProperty({ example: "BASE_PRICE" })
  componentCode!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      "What the Pricing Engine calculated, or null when it produced no line for this component. Kept beside the effective amount so a correction stays explainable.",
    example: "100.00",
  })
  engineAmount!: string | null;

  @ApiProperty({
    type: String,
    description: "The amount that counts: the override when one exists, else the engine's.",
    example: "120.00",
  })
  effectiveAmount!: string;

  @ApiProperty({
    enum: PricingAmountSource,
    description: "OVERRIDE when an operator corrected this component by hand.",
  })
  source!: PricingAmountSource;
}

export class EffectivePricingDto {
  @ApiProperty({ type: String, example: "120.00" })
  tarief!: string;

  @ApiProperty({
    type: String,
    description: "A percentage of the effective Tarief. Never edited directly.",
    example: "18.00",
  })
  brandstof!: string;

  @ApiProperty({
    type: String,
    description: "Follows Combination membership. Never edited directly.",
    example: "50.00",
  })
  backload!: string;

  @ApiProperty({ type: String, example: "30.00" })
  tol!: string;

  @ApiProperty({ type: String, example: "15.00" })
  tunnel!: string;

  @ApiProperty({
    type: String,
    description:
      "Waiting Time plus every priced Custom Property, TAR and Flat among them. Corrected by editing one of those, never here.",
    example: "130.00",
  })
  others!: string;

  @ApiProperty({
    type: String,
    description: "The Cost Confirmation amount. The confirmation is the evidence.",
    example: "165.00",
  })
  ek!: string;

  @ApiProperty({
    type: String,
    description: "The sum of the seven above. Always derived, never stored on its own.",
    example: "528.00",
  })
  totaal!: string;

  @ApiProperty({ type: [EffectivePricingComponentDto] })
  components!: EffectivePricingComponentDto[];
}

export function toEffectivePricingDto(
  pricing: EffectivePricing,
): EffectivePricingDto {
  return {
    tarief: pricing.tarief.toFixed(MONEY_DECIMAL_PLACES),
    brandstof: pricing.brandstof.toFixed(MONEY_DECIMAL_PLACES),
    backload: pricing.backload.toFixed(MONEY_DECIMAL_PLACES),
    tol: pricing.tol.toFixed(MONEY_DECIMAL_PLACES),
    tunnel: pricing.tunnel.toFixed(MONEY_DECIMAL_PLACES),
    others: pricing.others.toFixed(MONEY_DECIMAL_PLACES),
    ek: pricing.ek.toFixed(MONEY_DECIMAL_PLACES),
    totaal: pricing.totaal.toFixed(MONEY_DECIMAL_PLACES),
    components: pricing.components.map(toComponentDto),
  };
}

function toComponentDto(
  component: EffectiveAmount,
): EffectivePricingComponentDto {
  return {
    componentCode: component.componentCode,
    engineAmount:
      component.engineAmount?.toFixed(MONEY_DECIMAL_PLACES) ?? null,
    effectiveAmount: component.effectiveAmount.toFixed(MONEY_DECIMAL_PLACES),
    source: component.source,
  };
}
