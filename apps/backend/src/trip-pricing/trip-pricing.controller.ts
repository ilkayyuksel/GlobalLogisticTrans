import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CreateTripPricingDto } from "./dto/create-trip-pricing.dto";
import {
  TripIdParamDto,
  TripPricingIdParamDto,
} from "./dto/trip-pricing-params.dto";
import { TripPricingResponseDto } from "./dto/trip-pricing-response.dto";
import { UpdateTripPricingDto } from "./dto/update-trip-pricing.dto";
import { TripPricingService } from "./trip-pricing.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * This module persists pricing snapshots. It never calculates one — the future
 * Pricing Engine performs the arithmetic and posts the outcome here.
 *
 * There is no DELETE endpoint by design, and no list endpoint: a snapshot is
 * always reached through its Trip or its own id, and it is never removed,
 * because historical pricing must remain explainable.
 */
@ApiTags("Trip pricing")
@Controller("trip-pricing")
export class TripPricingController {
  constructor(private readonly tripPricingService: TripPricingService) {}

  /**
   * Declared before the ":id" route for readability; the two-segment path could
   * not collide with it in any case.
   */
  @Get("trip/:tripId")
  @ApiOperation({
    summary: "Get the pricing snapshot of a Trip",
    description:
      "A Trip has at most one snapshot. Returns null when the Trip has none — a CLOSED Trip awaiting its first calculation is an ordinary state, not an error.",
  })
  @ApiOkResponse({ type: TripPricingResponseDto })
  @ApiBadRequestResponse({ description: "The Trip id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  findByTripId(
    @Param() params: TripIdParamDto,
  ): Promise<TripPricingResponseDto | null> {
    return this.tripPricingService.findByTripId(params.tripId);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get one pricing snapshot",
    description: "Returns the snapshot whatever its calculation status.",
  })
  @ApiOkResponse({ type: TripPricingResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No pricing snapshot with that id." })
  findById(
    @Param() params: TripPricingIdParamDto,
  ): Promise<TripPricingResponseDto> {
    return this.tripPricingService.findById(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Create a pricing snapshot",
    description:
      "Persists a result already calculated by the Pricing Engine; no value is derived here. The Trip must exist, must be CLOSED, and must not already have a snapshot. The currency is always EUR and is not accepted as input.",
  })
  @ApiCreatedResponse({ type: TripPricingResponseDto })
  @ApiBadRequestResponse({
    description:
      "Missing or invalid field, amount, timestamp, calculation status or UUID.",
  })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  @ApiConflictResponse({
    description: "The Trip is not CLOSED, or it already has a snapshot.",
  })
  create(@Body() dto: CreateTripPricingDto): Promise<TripPricingResponseDto> {
    return this.tripPricingService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update the calculation metadata of a snapshot",
    description:
      "Partial update of the calculation status and its explanatory note. Nothing is recalculated. The total, the currency, the calculation timestamp and the two version fields are immutable: they describe the run that produced the amount, and editing them would make the snapshot claim an origin it does not have. Replacing the amounts is a reprocessing operation and belongs to the Pricing Engine.",
  })
  @ApiOkResponse({ type: TripPricingResponseDto })
  @ApiBadRequestResponse({
    description:
      "Invalid UUID or calculation status, or an immutable field was sent.",
  })
  @ApiNotFoundResponse({ description: "No pricing snapshot with that id." })
  update(
    @Param() params: TripPricingIdParamDto,
    @Body() dto: UpdateTripPricingDto,
  ): Promise<TripPricingResponseDto> {
    return this.tripPricingService.update(params.id, dto);
  }
}
