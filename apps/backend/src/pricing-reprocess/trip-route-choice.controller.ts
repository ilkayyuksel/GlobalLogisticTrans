import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";

import { PricingEngineExceptionFilter } from "../pricing-engine/exceptions/pricing-engine-exception.filter";
import { ManualRouteSelectionService } from "../pricing-engine/manual-route-selection.service";
import { TripIdParamDto } from "../trip-pricing/dto/trip-pricing-params.dto";
import {
  ChooseTripRouteDto,
  ChooseTripRouteResultDto,
  toRouteChoiceRequest,
} from "./dto/choose-trip-route.dto";

/**
 * "Route kiezen" from the Ritten list: the adapter for
 * `ManualRouteSelectionService`, which decides and prices. No rule lives here.
 */
@ApiTags("Trip pricing")
@Controller("trip-pricing")
@UseFilters(PricingEngineExceptionFilter)
export class TripRouteChoiceController {
  constructor(private readonly selection: ManualRouteSelectionService) {}

  @Post("trip/:tripId/route-choice")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Choose the route of a Trip whose automatic match is unusable",
    description:
      "Only while the automatic matcher finds nothing usable for the CLOSED Trip (NOT_FOUND/AMBIGUOUS in no group; LEG_NOT_IDENTIFIED/PAIR_NOT_CONFIGURED/AMBIGUOUS in a group with a CLOSED partner). A Trip in no group takes an ordinary route; a grouped Trip a Combination, whose other leg its partner is given automatically. The Trip (and partner) are priced on the choice by the Pricing Engine first; the choice and the snapshots are stored only when every leg priced on it, otherwise nothing changes. The snapshots record route_selection MANUAL. An explicit reprocess, a road, group or status change removes the choice.",
  })
  @ApiOkResponse({ type: ChooseTripRouteResultDto })
  @ApiBadRequestResponse({ description: "Both ids or neither, or a route of the wrong kind for the Trip." })
  @ApiNotFoundResponse({ description: "No such Trip, route or Combination." })
  @ApiConflictResponse({
    description:
      "The Trip is not CLOSED, its automatic match is usable, it has no unambiguous CLOSED partner, the roads contradict the named leg, or the Engine cannot price a leg on the choice.",
  })
  @ApiUnprocessableEntityResponse({
    description: "The roads do not say which leg this Trip is: send legPosition 1 or 2.",
  })
  async choose(
    @Param() params: TripIdParamDto,
    @Body() dto: ChooseTripRouteDto,
  ): Promise<ChooseTripRouteResultDto> {
    const request = toRouteChoiceRequest(dto);

    if (!request) {
      throw new BadRequestException("Kies precies één gewone route of één combinatieroute.");
    }

    return { pricedTripIds: await this.selection.choose(params.tripId, request) };
  }
}
