import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import {
  TripIdParamDto,
  TripPricingIdParamDto,
} from "./dto/trip-pricing-params.dto";
import {
  MAX_SNAPSHOT_TRIP_IDS,
  PricingSnapshotsQueryDto,
} from "./dto/pricing-snapshots-query.dto";
import { PricingSnapshotDto } from "./dto/pricing-snapshot.dto";
import { TripPricingResponseDto } from "./dto/trip-pricing-response.dto";
import { UpdateTripPricingDto } from "./dto/update-trip-pricing.dto";
import { TripPricingService } from "./trip-pricing.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * This module persists pricing snapshots. It never calculates one.
 *
 * The endpoints here are READ-ONLY apart from the calculation metadata. A
 * snapshot is created and replaced exclusively by the Pricing Engine, through
 * one atomic operation that writes the total and its breakdown together —
 * database_model.md §4.13 names the Engine as the owner, and the Frontend as
 * read-only.
 *
 * There is deliberately no POST. A snapshot whose total arrived from a caller
 * could not be trusted to equal the sum of its items, which §4.13 requires;
 * pricing is requested through POST /trip-pricing/trip/{tripId}/reprocess, which
 * calculates the total and writes both halves in one transaction.
 *
 * There is no DELETE endpoint either, and no list endpoint: a snapshot is
 * always reached through its Trip or its own id, and it is never removed,
 * because historical pricing must remain explainable.
 */
@ApiTags("Trip pricing")
@Controller("trip-pricing")
export class TripPricingController {
  constructor(private readonly tripPricingService: TripPricingService) {}

  /**
   * Declared before ":id" so the literal path wins the route match.
   */
  @Get("snapshots")
  @ApiOperation({
    summary: "The stored pricing of several Trips",
    description:
      "A bulk READ for exports and reports: it returns the snapshots and their lines exactly as the Pricing Engine stored them, and calculates nothing. Trips with no snapshot are absent from the result rather than reported as an error, because an unpriced Trip is an ordinary state. Reading pricing never causes a Trip to be priced.",
  })
  @ApiOkResponse({ type: [PricingSnapshotDto] })
  @ApiBadRequestResponse({
    description: `An id is not a valid UUID, the list is empty, or it holds more than ${MAX_SNAPSHOT_TRIP_IDS} ids.`,
  })
  findManyByTripIds(
    @Query() query: PricingSnapshotsQueryDto,
  ): Promise<PricingSnapshotDto[]> {
    return this.tripPricingService.findManyByTripIds(query.tripIds);
  }

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
