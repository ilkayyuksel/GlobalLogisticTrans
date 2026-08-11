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

import { CreateTripPricingItemDto } from "./dto/create-trip-pricing-item.dto";
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
 * This module persists the lines of a pricing breakdown. It never calculates
 * one, never sums them, and never touches the parent snapshot or the Trip.
 *
 * There is no DELETE endpoint and no replace endpoint by design: historical
 * pricing items are never removed, and replacing a whole breakdown is a
 * reprocessing operation belonging to the future Pricing Engine.
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

  @Post()
  @ApiOperation({
    summary: "Create a pricing item",
    description:
      "Persists one line already calculated by the Pricing Engine; no value is derived here. The snapshot must exist and the pricing component must exist and be active. A custom property reference is only valid on a CUSTOM_PROPERTY item, and the same property may be priced only once per snapshot. The currency is always EUR and is not accepted as input.",
  })
  @ApiCreatedResponse({ type: TripPricingItemResponseDto })
  @ApiBadRequestResponse({
    description:
      "Missing or invalid field, amount, quantity, calculation order or UUID.",
  })
  @ApiNotFoundResponse({
    description:
      "The referenced pricing snapshot, pricing component or custom property does not exist.",
  })
  @ApiConflictResponse({
    description:
      "The pricing component is inactive, the custom property reference does not belong on this component, or that property is already priced in this snapshot.",
  })
  create(
    @Body() dto: CreateTripPricingItemDto,
  ): Promise<TripPricingItemResponseDto> {
    return this.tripPricingItemService.create(dto);
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
