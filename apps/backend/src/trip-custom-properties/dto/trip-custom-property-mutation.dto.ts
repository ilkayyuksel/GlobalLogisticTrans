import { ApiProperty } from "@nestjs/swagger";

import { EffectivePricingDto } from "../../trip-pricing/dto/effective-pricing.dto";
import { TripCustomPropertyResponseDto } from "./trip-custom-property-response.dto";

/**
 * What an assignment or a removal answers with.
 *
 * ── WHY THE PRICE TRAVELS WITH THE ASSIGNMENT ───────────────────────────────
 * A priced Custom Property changes Others, and Others changes Totaal. A screen
 * that received only the assignment would have to ask a second endpoint what
 * the Trip is now worth — a second round trip that can fail on its own, arrive
 * out of order, or be skipped by a caller who forgets. The write already knows
 * the answer, so it gives it.
 *
 * ── AND WHY IT MAY BE ABSENT ────────────────────────────────────────────────
 * The assignment is kept whatever pricing does. If the recalculation cannot
 * produce a figure — an unconfigured route is the ordinary case, not an edge
 * one — the write still stands, the response is still a success, `pricing` is
 * null and `reasonCode` says why. The PREVIOUS figures are never returned:
 * showing yesterday's total as though it were current is worse than showing
 * none, because nothing on the screen would reveal it.
 *
 * It extends the assignment response rather than wrapping it, so a client that
 * only cares about the assignment reads exactly the fields it always did.
 * ────────────────────────────────────────────────────────────────────────────
 */
export class TripCustomPropertyMutationDto extends TripCustomPropertyResponseDto {
  @ApiProperty({
    type: EffectivePricingDto,
    nullable: true,
    description:
      "The Trip's complete effective pricing after this change, with any operator override applied. Null when the Trip could not be priced — see reasonCode. Never the pricing from before the change.",
  })
  pricing!: EffectivePricingDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Why there is no pricing, as a stable machine-readable code — PRICING_MISSING_ROUTE_PRICING, PRICING_TRIP_NOT_CLOSED, PRICING_MISSING_ROUTE_COST and so on. Null whenever pricing is present.",
    example: "PRICING_MISSING_ROUTE_PRICING",
  })
  reasonCode!: string | null;
}
