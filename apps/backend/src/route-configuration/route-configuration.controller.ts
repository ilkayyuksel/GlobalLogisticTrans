import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { RouteConfigurationIdParamDto } from "./dto/route-configuration-id-param.dto";
import {
  ChangeRouteConfigurationStateDto,
  RouteConfigurationDto,
  SaveRouteConfigurationDto,
} from "./dto/route-configuration.dto";
import { RouteConfigurationService } from "./route-configuration.service";

/**
 * Route pricing, as one record per route.
 *
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * Every route here is protected by the application's global access-token
 * guard — none of them is marked public — so only an authenticated operator
 * can read or change pricing configuration. No actor identity is accepted from
 * the caller, because none is stored: a route configuration records what a
 * route costs, not who said so.
 */
@ApiTags("Route configuration")
@Controller("route-configuration")
export class RouteConfigurationController {
  constructor(private readonly service: RouteConfigurationService) {}

  @Get()
  @ApiOperation({
    summary: "List every configured route",
    description:
      "One record per route, active and inactive, each carrying its Tarief, Toll and Tunnel. Deliberately not paginated: this is configuration read as a whole, and the set is bounded by the routes the business runs.",
  })
  @ApiOkResponse({ type: [RouteConfigurationDto] })
  findAll(): Promise<RouteConfigurationDto[]> {
    return this.service.findAll();
  }

  @Post()
  @ApiOperation({
    summary: "Configure a route",
    description:
      "Creates the route's price and both of its route costs together. A second ACTIVE configuration of the same canonical route is refused — PSA Quay 869 and Quay 869 are the same departure, while Quay 869 to Dourges and Dourges to Quay 869 are different routes. Zero is a valid amount for any of the three.",
  })
  @ApiCreatedResponse({ type: RouteConfigurationDto })
  @ApiBadRequestResponse({
    description: "A missing or blank endpoint, or an amount below zero.",
  })
  @ApiConflictResponse({
    description: "That route already has an active configuration.",
  })
  create(
    @Body() dto: SaveRouteConfigurationDto,
  ): Promise<RouteConfigurationDto> {
    return this.service.create(dto);
  }

  @Put(":id")
  @ApiOperation({
    summary: "Change a route's configuration",
    description:
      "Replaces all three amounts, and moves the route when either end changes — the costs move with it. Historical pricing is untouched: a Trip already priced keeps the amounts it was priced with, and only a later calculation or an explicit reprocess reads the new configuration.",
  })
  @ApiOkResponse({ type: RouteConfigurationDto })
  @ApiBadRequestResponse({ description: "A malformed id or amount." })
  @ApiNotFoundResponse({ description: "No configuration with that id." })
  @ApiConflictResponse({
    description: "Moving it would collide with another active configuration.",
  })
  update(
    @Param() params: RouteConfigurationIdParamDto,
    @Body() dto: SaveRouteConfigurationDto,
  ): Promise<RouteConfigurationDto> {
    return this.service.update(params.id, dto);
  }

  @Patch(":id/state")
  @ApiOperation({
    summary: "Activate or deactivate a route configuration",
    description:
      "The price and both costs move together, so a route is never half active. Deactivating deletes nothing: the record stays, and every Trip already priced against it keeps its pricing. Only the Pricing Engine stops reading it.",
  })
  @ApiOkResponse({ type: RouteConfigurationDto })
  @ApiNotFoundResponse({ description: "No configuration with that id." })
  @ApiConflictResponse({
    description:
      "Reactivating would collide with another active configuration of the same route.",
  })
  changeState(
    @Param() params: RouteConfigurationIdParamDto,
    @Body() dto: ChangeRouteConfigurationStateDto,
  ): Promise<RouteConfigurationDto> {
    return this.service.changeState(params.id, dto);
  }
}
