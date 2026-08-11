import { Module } from "@nestjs/common";

import { DriverModule } from "../drivers/driver.module";
import { VehicleModule } from "../vehicles/vehicle.module";
import { VehicleAssignmentController } from "./vehicle-assignment.controller";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";
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
  imports: [VehicleModule, DriverModule],
  controllers: [VehicleAssignmentController],
  providers: [VehicleAssignmentService, VehicleAssignmentRepository],
  exports: [VehicleAssignmentService],
})
export class VehicleAssignmentModule {}
