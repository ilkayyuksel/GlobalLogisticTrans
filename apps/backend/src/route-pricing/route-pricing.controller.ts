import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
   * Sub-resource rather than a verb in the path, matching the pattern used by
   * Driver and Vehicle.
   */
  @Patch(":id/activation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Activate a route pricing record",
    description:
      "Makes the record eligible for pricing. Idempotent. Fails if another active record now covers the same route.",
  })
  @ApiOkResponse({ type: RoutePricingResponseDto })
  @ApiNotFoundResponse({ description: "No route pricing with that id." })
  @ApiConflictResponse({
    description: "Another active record already covers this route.",
  })
  activate(
    @Param() params: RoutePricingIdParamDto,
  ): Promise<RoutePricingResponseDto> {
    return this.routePricingService.activate(params.id);
  }

  @Patch(":id/deactivation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Deactivate a route pricing record",
    description:
      "Soft delete. The record is retained so pricing already derived from it stays explainable; it simply stops being eligible for new calculations. Idempotent.",
  })
  @ApiOkResponse({ type: RoutePricingResponseDto })
  @ApiNotFoundResponse({ description: "No route pricing with that id." })
  deactivate(
    @Param() params: RoutePricingIdParamDto,
  ): Promise<RoutePricingResponseDto> {
    return this.routePricingService.deactivate(params.id);
  }
}
