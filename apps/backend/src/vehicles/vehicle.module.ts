import { Module } from "@nestjs/common";

import { VehicleController } from "./vehicle.controller";
import { VehicleRepository } from "./vehicle.repository";
import { VehicleService } from "./vehicle.service";

/**
 * PrismaModule and LoggerModule are global, so no imports are needed.
 *
 * VehicleService is exported because other modules will need to resolve
 * vehicles: VehicleAssignment links them to drivers, Trip assigns one, and
 * Maintenance attaches to one. Those consumers depend on the service, never on
 * the repository, so database access stays behind a single door.
 */
@Module({
  controllers: [VehicleController],
  providers: [VehicleService, VehicleRepository],
  exports: [VehicleService],
})
export class VehicleModule {}
