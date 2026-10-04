import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  BulkRemoveRouteConfigurationDto,
  BulkRemoveRouteConfigurationResultDto,
} from "./dto/bulk-remove-route-configuration.dto";
import { EmptyBulkRemovalException } from "./exceptions/route-configuration.exceptions";
import { RouteConfigurationUnitOfWork } from "./route-configuration.unit-of-work";

/**
 * Deletes several route configurations — routes and Combinations — together.
 *
 * ── ALL OF THEM, OR NONE ────────────────────────────────────────────────────
 * One transaction for the whole selection. Each record goes through the SAME
 * deletion a single delete uses — an ordinary route's tunnel deactivated, a
 * Combination removed with both legs and their tunnels in one statement — so a
 * bulk delete cannot do anything a single one would not. If any record is
 * refused (gone already, or a leg named as if it were a route), nothing is
 * deleted: a selection half-removed is a state an operator could not see from
 * the screen, and a Combination with one leg is a state the model refuses.
 *
 * ── HISTORY IS UNTOUCHED ────────────────────────────────────────────────────
 * A TripPricing snapshot stores the amounts it was priced with and reads no
 * configuration again, so removing routes changes no historical price.
 */
@Injectable()
export class RouteConfigurationBulkRemovalService {
  constructor(
    private readonly unitOfWork: RouteConfigurationUnitOfWork,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(RouteConfigurationBulkRemovalService.name);
  }

  async remove(
    dto: BulkRemoveRouteConfigurationDto,
  ): Promise<BulkRemoveRouteConfigurationResultDto> {
    // The same id twice is one record, not a second deletion that must fail.
    const routeIds = [...new Set(dto.routeIds)];
    const combinationGroupIds = [...new Set(dto.combinationGroupIds)];

    if (routeIds.length === 0 && combinationGroupIds.length === 0) {
      throw new EmptyBulkRemovalException();
    }

    await this.unitOfWork.run(async (services) => {
      for (const id of routeIds) {
        await services.routes.remove(id);
      }

      for (const combinationGroupId of combinationGroupIds) {
        await services.combinations.remove(combinationGroupId);
      }
    });

    this.logger.log("Route configurations deleted in bulk", {
      removedRoutes: routeIds.length,
      removedCombinations: combinationGroupIds.length,
    });

    return {
      removedRoutes: routeIds.length,
      removedCombinations: combinationGroupIds.length,
    };
  }
}
