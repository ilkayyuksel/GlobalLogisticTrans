import { Body, Controller, Delete, Param, Put } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CurrentSubject } from "../auth/current-subject.decorator";
import { EffectivePricingDto } from "./dto/effective-pricing.dto";
import { TripPricingOverrideParamsDto } from "./dto/trip-pricing-override-params.dto";
import { TripIdParamDto } from "./dto/trip-pricing-params.dto";
import { UpsertTripPricingOverrideDto } from "./dto/upsert-trip-pricing-override.dto";
import { TripPricingOverrideService } from "./trip-pricing-override.service";

/**
 * Manual price corrections, kept apart from TripPricingController.
 *
 * That controller documents itself as read-only apart from calculation
 * metadata, and it is the door to the Engine's own snapshots. An override is a
 * different thing with a different owner — the operator rather than the Engine
 * — so it gets its own door rather than quietly contradicting that contract.
 *
 * Both operations answer with the WHOLE recalculated breakdown. One save is one
 * request and one authoritative answer: the screen never has to ask again for
 * the components that moved, and it never computes them itself.
 */
@ApiTags("Trip pricing")
@Controller("trip-pricing")
export class TripPricingOverrideController {
  constructor(private readonly service: TripPricingOverrideService) {}

  @Put("trip/:tripId/overrides")
  @ApiOperation({
    summary: "Record a manual price correction for one component of a Trip",
    description:
      "Only BASE_PRICE, TOLL and TUNNEL may be corrected; every other component is derived from something the operator can already change, and a request naming one is refused. A second correction of the same component replaces the first rather than accumulating. Zero is stored as an explicit 0.00, not as a withdrawal — withdrawing is DELETE. The author is taken from the verified access token and can never be supplied by the caller. Returns the recalculated breakdown, or null when the Trip has not been priced yet.",
  })
  @ApiOkResponse({ type: EffectivePricingDto })
  @ApiBadRequestResponse({
    description:
      "The Trip id is not a valid UUID, the amount is out of range or has more than two decimals, or the component does not admit an override.",
  })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  upsert(
    @Param() params: TripIdParamDto,
    @Body() dto: UpsertTripPricingOverrideDto,
    @CurrentSubject() subject: string,
  ): Promise<EffectivePricingDto | null> {
    return this.service.upsert(params.tripId, dto, subject);
  }

  @Delete("trip/:tripId/overrides/:componentCode")
  @ApiOperation({
    summary: "Withdraw a manual price correction",
    description:
      "Returns the component to the amount the Pricing Engine calculated, and recalculates everything that followed from it. Allowed for the same three components that admit an override. A component carrying no correction is a 404 rather than a silent success, because a screen must not report a value restored that never moved.",
  })
  @ApiOkResponse({ type: EffectivePricingDto })
  @ApiBadRequestResponse({
    description:
      "The Trip id is not a valid UUID, or the component does not admit an override.",
  })
  @ApiNotFoundResponse({
    description: "No Trip with that id, or no correction for that component.",
  })
  reset(
    @Param() params: TripPricingOverrideParamsDto,
  ): Promise<EffectivePricingDto | null> {
    return this.service.reset(params.tripId, params.componentCode);
  }
}
