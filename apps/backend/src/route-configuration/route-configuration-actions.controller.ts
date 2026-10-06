import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CombinationLegSyncService } from "./combination-leg-sync.service";
import {
  BulkRemoveRouteConfigurationDto,
  BulkRemoveRouteConfigurationResultDto,
} from "./dto/bulk-remove-route-configuration.dto";
import { CombinationLegParamDto, CombinationLegSyncDto } from "./dto/combination-leg-sync.dto";
import { RouteConfigurationBulkRemovalService } from "./route-configuration-bulk-removal.service";

/**
 * Actions on SEVERAL route configurations at once.
 *
 * Beside `RouteConfigurationController` rather than inside it: that one is about
 * one record at a time, and both kinds of action here run their whole
 * selection in one transaction through the very services the single-record
 * endpoints use. Same path prefix, so the API reads as one resource.
 */
@ApiTags("Route configuration")
@Controller("route-configuration")
export class RouteConfigurationActionsController {
  constructor(
    private readonly bulkRemoval: RouteConfigurationBulkRemovalService,
    private readonly legSync: CombinationLegSyncService,
  ) {}

  /*
   * POST rather than DELETE: the selection is a body, and a DELETE with a body
   * is ignored or refused by enough proxies to make it a trap.
   */
  @Post("bulk-delete")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Delete several routes and Combinations together",
    description:
      "One transaction for the whole selection, each record removed exactly as the single delete removes it — a Combination always with both legs. If any record cannot be removed, nothing is. Historical Trip pricing is unaffected.",
  })
  @ApiOkResponse({ type: BulkRemoveRouteConfigurationResultDto })
  @ApiBadRequestResponse({ description: "Nothing named, an id that is not a UUID, or too many ids." })
  @ApiNotFoundResponse({ description: "A named record does not exist; nothing was deleted." })
  @ApiConflictResponse({ description: "A Combination leg was named as a route; nothing was deleted." })
  removeMany(
    @Body() dto: BulkRemoveRouteConfigurationDto,
  ): Promise<BulkRemoveRouteConfigurationResultDto> {
    return this.bulkRemoval.remove(dto);
  }

  @Get("combinations/:combinationGroupId/legs/:legPosition/sync-targets")
  @ApiOperation({
    summary: "Which Combinations a price sync of this leg would reach",
    description:
      "Every OTHER Combination whose leg in the same position runs exactly this leg's From and To. Writes nothing — it is what the confirmation shows.",
  })
  @ApiOkResponse({ type: CombinationLegSyncDto })
  @ApiNotFoundResponse({ description: "No Combination with that id." })
  previewSync(@Param() params: CombinationLegParamDto): Promise<CombinationLegSyncDto> {
    return this.legSync.preview(params.combinationGroupId, params.legPosition);
  }

  @Post("combinations/:combinationGroupId/legs/:legPosition/sync")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Copy this leg's prices to every matching leg of other Combinations",
    description:
      "Tarief, Toll and Tunnel exactly as this leg stores them, to every other Combination's leg in the same position with the same From and To — in one transaction, through the same update an inline edit uses. Never an ordinary route, never the other position, never Over ST.",
  })
  @ApiOkResponse({ type: CombinationLegSyncDto })
  @ApiNotFoundResponse({ description: "No Combination with that id." })
  sync(@Param() params: CombinationLegParamDto): Promise<CombinationLegSyncDto> {
    return this.legSync.sync(params.combinationGroupId, params.legPosition);
  }
}
