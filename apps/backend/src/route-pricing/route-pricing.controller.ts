import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Delete,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CreateRoutePricingDto } from "./dto/create-route-pricing.dto";
import { ListRoutePricingQueryDto } from "./dto/list-route-pricing-query.dto";
import { RoutePricingIdParamDto } from "./dto/route-pricing-id-param.dto";
import {
  PaginatedRoutePricingDto,
  RoutePricingResponseDto,
} from "./dto/route-pricing-response.dto";
import { UpdateRoutePricingDto } from "./dto/update-route-pricing.dto";
import { RoutePricingService } from "./route-pricing.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * This module stores pricing configuration only. It never calculates a price —
 * that belongs to the future Pricing Engine, which will read these records.
 *
 * There is no DELETE endpoint by design — records are never physically removed,
 * so pricing already derived from a route stays explainable. Withdrawing a
 * route from use is expressed as deactivation.
 */
@ApiTags("Route pricing")
@Controller("route-pricing")
export class RoutePricingController {
  constructor(private readonly routePricingService: RoutePricingService) {}

  @Get()
  @ApiOperation({
    summary: "List route pricing records",
    description:
      "Paginated. Returns both active and inactive records unless isActive is supplied. Search matches route name, departure and destination.",
  })
  @ApiOkResponse({ type: PaginatedRoutePricingDto })
  @ApiBadRequestResponse({ description: "Invalid pagination or filter value." })
  findAll(
    @Query() query: ListRoutePricingQueryDto,
  ): Promise<PaginatedRoutePricingDto> {
    return this.routePricingService.findAll(query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get one route pricing record",
    description: "Returns the record regardless of its active state.",
  })
  @ApiOkResponse({ type: RoutePricingResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No route pricing with that id." })
  findById(
    @Param() params: RoutePricingIdParamDto,
  ): Promise<RoutePricingResponseDto> {
    return this.routePricingService.findById(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Create a route pricing record",
    description:
      "Records are created active. No other active record may already exist for the same departure and destination.",
  })
  @ApiCreatedResponse({ type: RoutePricingResponseDto })
  @ApiBadRequestResponse({
    description: "Missing or invalid field, or an invalid price.",
  })
  @ApiConflictResponse({
    description: "An active record already exists for this route.",
  })
  create(
    @Body() dto: CreateRoutePricingDto,
  ): Promise<RoutePricingResponseDto> {
    return this.routePricingService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update a route pricing record",
    description:
      "Partial update. Omitted fields are unchanged; send null to clear notes. Moving the route re-checks uniqueness. Active state is changed through the activate and deactivate endpoints.",
  })
  @ApiOkResponse({ type: RoutePricingResponseDto })
  @ApiBadRequestResponse({ description: "Invalid field, UUID or price." })
  @ApiNotFoundResponse({ description: "No route pricing with that id." })
  @ApiConflictResponse({
    description: "Another active record already covers the new route.",
  })
  update(
    @Param() params: RoutePricingIdParamDto,
    @Body() dto: UpdateRoutePricingDto,
  ): Promise<RoutePricingResponseDto> {
    return this.routePricingService.update(params.id, dto);
  }

  /**
   * Removes a route's configuration.
   *
   * ── DELETE RATHER THAN DEACTIVATION ───────────────────────────────────────
   * This used to be a pair of activation endpoints. A route price now exists or
   * it does not: the flag produced a second state the configuration screen had
   * no use for, and a route that looked configured while charging nothing.
   *
   * Pricing already calculated is unaffected. A TripPricing snapshot holds the
   * amounts it was priced with and reads no configuration again, so removing
   * the row explains yesterday's price exactly as well as keeping it did.
   *
   * 200 with the removed record rather than 204, the convention every DELETE in
   * this API follows: each response carries the standard envelope.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Delete a route pricing record",
    description:
      "Removes the configuration. Trips already priced keep the amounts they were priced with; Trips priced afterwards find no configuration for this route.",
  })
  @ApiOkResponse({ type: RoutePricingResponseDto })
  @ApiNotFoundResponse({ description: "No route pricing with that id." })
  remove(
    @Param() params: RoutePricingIdParamDto,
  ): Promise<RoutePricingResponseDto> {
    return this.routePricingService.remove(params.id);
  }
}
