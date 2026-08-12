import { Module } from "@nestjs/common";

import { RouteCostController } from "./route-cost.controller";
import { RouteCostRepository } from "./route-cost.repository";
import { RouteCostService } from "./route-cost.service";

/**
 * PrismaModule and LoggerModule are global, so no imports are needed.
 *
 * RouteCostService is exported because the Toll and Tunnel calculators will need
 * to read the configured amount for a route. They will depend on the service,
 * never on the repository, so database access stays behind a single door.
 */
@Module({
  controllers: [RouteCostController],
  providers: [RouteCostService, RouteCostRepository],
  exports: [RouteCostService],
})
export class RouteCostModule {}
