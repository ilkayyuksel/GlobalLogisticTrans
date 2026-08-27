import { Module } from "@nestjs/common";

import { DriverModule } from "../drivers/driver.module";
import { VehicleModule } from "../vehicles/vehicle.module";
import { CurrentAssignmentModule } from "./current-assignment.module";
import { VehicleAssignmentController } from "./vehicle-assignment.controller";
import { VehicleAssignmentService } from "./vehicle-assignment.service";

/**
 * PrismaModule and LoggerModule are global, so only the two collaborators are
 * imported.
 *
 * DriverModule and VehicleModule are imported for their exported services:
 * verifying that a driver and a vehicle exist reuses their lookups and their
 * 404s instead of re-querying those tables from this repository, which would
 * cross domain ownership.
 *
 * VehicleAssignmentService is exported because Trip will need it to resolve the
 * driver of a vehicle on a planning date.
 */
@Module({
  // CurrentAssignmentModule supplies the repository. It imports neither Vehicle
  // nor Driver, so nothing here becomes circular.
  imports: [VehicleModule, DriverModule, CurrentAssignmentModule],
  controllers: [VehicleAssignmentController],
  providers: [VehicleAssignmentService],
  exports: [VehicleAssignmentService],
})
export class VehicleAssignmentModule {}
