import { Controller, HttpCode, HttpStatus, Param, Post, UseFilters } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { PricingEngineExceptionFilter } from "../pricing-engine/exceptions/pricing-engine-exception.filter";
import { PricingEngineService } from "../pricing-engine/pricing-engine.service";
import { PricingSnapshotDto } from "../trip-pricing/dto/pricing-snapshot.dto";
import { TripIdParamDto } from "../trip-pricing/dto/trip-pricing-params.dto";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";

/**
 * The Pricing Engine's only REST surface.
 *
 * The Engine itself stays a domain service with no controller and no repository
 * — that separation is what lets a queue worker or a scheduled job drive it
 * later without inheriting anything HTTP. This controller is the adapter: it
 * translates one request into one Engine operation and its result into a
 * response, and it owns the mapping from the Engine's domain failures to status
 * codes.
 *
 * It performs no validation of its own. Every precondition — the Trip, its
 * CLOSED status, the Settings, the route and property configuration — is
 * enforced inside the Engine, so this endpoint and any future trigger apply
 * exactly the same rules.
 *
 * Reprocessing is addressed through the Trip because the Trip owns its
 * snapshot: there is at most one, and it has no identity a caller should have
 * to know in order to ask for a new calculation.
 */
@ApiTags("Trip pricing")
@Controller("trip-pricing")
@UseFilters(PricingEngineExceptionFilter)
export class PricingReprocessController {
  constructor(
    private readonly pricingEngine: PricingEngineService,
    private readonly tripPricingService: TripPricingService,
  ) {}

  @Post("trip/:tripId/reprocess")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reprocess the pricing of a Trip",
    description:
      "Recalculate pricing for a CLOSED Trip, or calculate its first pricing snapshot if none exists. The Trip must exist and be CLOSED; nothing else is required. When a snapshot is already there it keeps its id and its breakdown is replaced in full, so a component that no longer applies does not survive. When there is none — because automatic pricing failed and CLOSED is terminal — this creates it, which is how such a Trip is recovered once the configuration is corrected. Calculation and storage are atomic: if either fails, any previous snapshot is left exactly as it was.",
  })
  @ApiOkResponse({
    type: PricingSnapshotDto,
    description:
      "The newly stored snapshot, its complete breakdown and the route it was priced against (`routeMatch`) — the same shape GET /trip-pricing/snapshots answers, read back from what was stored.",
  })
  @ApiBadRequestResponse({ description: "The Trip id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No Trip with that id." })
  @ApiConflictResponse({
    description:
      "The Trip is not CLOSED, or the current configuration cannot price it — a missing or unusable pricing Setting, no active route pricing, a route-priced property whose route cost is not configured, or a fixed-price property with no price.",
  })
  async reprocess(@Param() params: TripIdParamDto): Promise<PricingSnapshotDto> {
    await this.pricingEngine.reprocess(params.tripId);

    return this.readStoredSnapshot(params.tripId);
  }

  /**
   * Reads back what was just stored, rather than rendering the in-memory
   * result — and matches nothing again.
   *
   * The header, the lines and the route the price was matched to come from ONE
   * consistent read of ONE stored calculation — exactly as GET
   * /trip-pricing/snapshots answers it. Matching the route again for the
   * response could name a route other than the one that produced the price. A
   * Trip reopened between the write and this read is refused by the read side
   * (only a finished Trip has a current price), never shown its old snapshot.
   */
  private readStoredSnapshot(tripId: string): Promise<PricingSnapshotDto> {
    return this.tripPricingService.requireCurrentSnapshot(tripId);
  }
}
