import { Module } from "@nestjs/common";

import { CurrentAssignmentModule } from "../vehicle-assignments/current-assignment.module";
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
  // The read side of vehicle ↔ driver, so the list can name today's driver.
  // It imports nothing, which is what keeps this from closing a cycle with
  // VehicleAssignmentModule — that one imports THIS module.
  imports: [CurrentAssignmentModule],
  controllers: [VehicleController],
  providers: [VehicleService, VehicleRepository],
  exports: [VehicleService],
})
export class VehicleModule {}
