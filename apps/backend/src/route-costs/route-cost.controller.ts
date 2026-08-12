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

import { CreateRouteCostDto } from "./dto/create-route-cost.dto";
import { ListRouteCostsQueryDto } from "./dto/list-route-costs-query.dto";
import { RouteCostIdParamDto } from "./dto/route-cost-id-param.dto";
import {
  PaginatedRouteCostsDto,
  RouteCostResponseDto,
} from "./dto/route-cost-response.dto";
import { UpdateRouteCostDto } from "./dto/update-route-cost.dto";
import { RouteCostService } from "./route-cost.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * This module stores what a route-dependent component costs on a route. It
 * never calculates a price and never decides whether a component applies to a
 * Trip — applicability comes from trip_custom_property, and the arithmetic
 * belongs to the Pricing Engine.
 *
 * There is no DELETE endpoint by design — records are never physically removed,
 * so pricing already derived from a route cost stays explainable. Withdrawing
 * one from use is expressed as deactivation.
 */
@ApiTags("Route costs")
@Controller("route-costs")
export class RouteCostController {
  constructor(private readonly routeCostService: RouteCostService) {}

  @Get()
  @ApiOperation({
    summary: "List route costs",
    description:
      "Paginated. Returns both active and inactive records unless isActive is supplied. Search matches departure and destination; pricingComponentId narrows to one component.",
  })
  @ApiOkResponse({ type: PaginatedRouteCostsDto })
  @ApiBadRequestResponse({ description: "Invalid pagination or filter value." })
  findAll(
    @Query() query: ListRouteCostsQueryDto,
  ): Promise<PaginatedRouteCostsDto> {
    return this.routeCostService.findAll(query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get one route cost",
    description: "Returns the record regardless of its active state.",
  })
  @ApiOkResponse({ type: RouteCostResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({ description: "No route cost with that id." })
  findById(
    @Param() params: RouteCostIdParamDto,
  ): Promise<RouteCostResponseDto> {
    return this.routeCostService.findById(params.id);
  }

  @Post()
  @ApiOperation({
    summary: "Create a route cost",
    description:
      "Records are created active. The component must be route-priced, and no other active record may already exist for the same departure, destination and component.",
  })
  @ApiCreatedResponse({ type: RouteCostResponseDto })
  @ApiBadRequestResponse({
    description: "Missing or invalid field, or a negative or malformed amount.",
  })
  @ApiNotFoundResponse({ description: "The pricing component does not exist." })
  @ApiConflictResponse({
    description:
      "The component is not route-priced, or an active record already exists for this route and component.",
  })
  create(@Body() dto: CreateRouteCostDto): Promise<RouteCostResponseDto> {
    return this.routeCostService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update a route cost",
    description:
      "Partial update. Omitted fields are unchanged; send null to clear notes. Moving the route or the component re-checks uniqueness. Active state is changed through the activation and deactivation endpoints.",
  })
  @ApiOkResponse({ type: RouteCostResponseDto })
  @ApiBadRequestResponse({ description: "Invalid field, UUID or amount." })
  @ApiNotFoundResponse({
    description: "No route cost with that id, or the new component does not exist.",
  })
  @ApiConflictResponse({
    description:
      "The new component is not route-priced, or another active record already covers the new route and component.",
  })
  update(
    @Param() params: RouteCostIdParamDto,
    @Body() dto: UpdateRouteCostDto,
  ): Promise<RouteCostResponseDto> {
    return this.routeCostService.update(params.id, dto);
  }

  /**
   * Sub-resource rather than a verb in the path, matching the pattern used by
   * RoutePricing, Driver and Vehicle.
   */
  @Patch(":id/activation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Activate a route cost",
    description:
      "Makes the record eligible for pricing. Idempotent. Fails if another active record now covers the same route and component.",
  })
  @ApiOkResponse({ type: RouteCostResponseDto })
  @ApiNotFoundResponse({ description: "No route cost with that id." })
  @ApiConflictResponse({
    description: "Another active record already covers this route and component.",
  })
  activate(
    @Param() params: RouteCostIdParamDto,
  ): Promise<RouteCostResponseDto> {
    return this.routeCostService.activate(params.id);
  }

  @Patch(":id/deactivation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Deactivate a route cost",
    description:
      "Soft delete, never blocked by historical pricing. Trip pricing items already written from this record keep their frozen amounts; the record simply stops being eligible for new calculations. Idempotent.",
  })
  @ApiOkResponse({ type: RouteCostResponseDto })
  @ApiNotFoundResponse({ description: "No route cost with that id." })
  deactivate(
    @Param() params: RouteCostIdParamDto,
  ): Promise<RouteCostResponseDto> {
    return this.routeCostService.deactivate(params.id);
  }
}
