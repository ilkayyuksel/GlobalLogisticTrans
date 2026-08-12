import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import {
  TripPricingIdParamDto,
  TripPricingItemIdParamDto,
} from "./dto/trip-pricing-item-params.dto";
import {
  TripPricingBreakdownDto,
  TripPricingItemResponseDto,
} from "./dto/trip-pricing-item-response.dto";
import { UpdateTripPricingItemDto } from "./dto/update-trip-pricing-item.dto";
import { TripPricingItemService } from "./trip-pricing-item.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * This module reads the lines of a pricing breakdown. It never calculates one
 * and never sums them.
 *
 * The endpoints here are READ-ONLY apart from a line's note. Lines are written
 * exclusively by the Pricing Engine, together with their parent, in one atomic
 * operation — database_model.md §4.14: "Only the Pricing Engine may create or
 * update TripPricingItems."
 *
 * There is deliberately no POST. A line added on its own would change the sum
 * of the breakdown without changing the parent's total, and §4.13 requires the
 * two to be equal. Adding to a breakdown therefore means recalculating it,
 * which is POST /trip-pricing/trip/{tripId}/reprocess.
 *
 * There is no DELETE endpoint and no replace endpoint either: an individual
 * line is never removed, and replacing a whole breakdown is the Engine's
 * reprocessing operation.
 */
@ApiTags("Trip pricing items")
@Controller("trip-pricing-items")
export class TripPricingItemController {
  constructor(
    private readonly tripPricingItemService: TripPricingItemService,
  ) {}

  /**
   * Declared before the ":id" route for readability; the two-segment path could
   * not collide with it in any case.
   */
  @Get("trip-pricing/:tripPricingId")
  @ApiOperation({
    summary: "Get the complete breakdown of a pricing snapshot",
    description:
      "Every line of the snapshot, in calculation order. Deliberately not paginated: a breakdown is only correct when it is whole, and the exported pricing must match the stored pricing exactly. Returns an empty list when the snapshot has no lines yet.",
  })
  @ApiOkResponse({ type: TripPricingBreakdownDto })
  @ApiBadRequestResponse({
    description: "The pricing snapshot id is not a valid UUID.",
  })
  @ApiNotFoundResponse({ description: "No pricing snapshot with that id." })
  findByTripPricingId(
    @Param() params: TripPricingIdParamDto,
  ): Promise<TripPricingBreakdownDto> {
    return this.tripPricingItemService.findByTripPricingId(
      params.tripPricingId,
    );
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get one pricing item",
    description: "Returns a single line of a breakdown.",
  })
  @ApiOkResponse({ type: TripPricingItemResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No pricing item with that id." })
  findById(
    @Param() params: TripPricingItemIdParamDto,
  ): Promise<TripPricingItemResponseDto> {
    return this.tripPricingItemService.findById(params.id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update the note of a pricing item",
    description:
      "The note is the only mutable field. The amount, quantity, unit price, currency, description, calculation order, pricing component and custom property reference are all immutable: they are the calculated result and its provenance, and changing one would break the parent snapshot's requirement that its total equal the sum of its lines. Send null to clear the note.",
  })
  @ApiOkResponse({ type: TripPricingItemResponseDto })
  @ApiBadRequestResponse({
    description: "Invalid UUID or note, or an immutable field was sent.",
  })
  @ApiNotFoundResponse({ description: "No pricing item with that id." })
  update(
    @Param() params: TripPricingItemIdParamDto,
    @Body() dto: UpdateTripPricingItemDto,
  ): Promise<TripPricingItemResponseDto> {
    return this.tripPricingItemService.update(params.id, dto);
  }
}
