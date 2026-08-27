import { Module } from "@nestjs/common";

import { CurrentAssignmentModule } from "../vehicle-assignments/current-assignment.module";
import { DriverController } from "./driver.controller";
import { DriverRepository } from "./driver.repository";
import { DriverService } from "./driver.service";

/**
 * PrismaModule and LoggerModule are global, so no imports are needed.
 *
 * DriverService is exported because other modules will need to resolve drivers:
 * VehicleAssignment links them to vehicles and Trip carries a driver override.
 * Those consumers depend on the service, never on the repository, so database
 * access stays behind a single door.
 */
@Module({
  // The same read side the Voertuigen list uses, asked in the other direction.
  imports: [CurrentAssignmentModule],
  controllers: [DriverController],
  providers: [DriverService, DriverRepository],
  exports: [DriverService],
})
export class DriverModule {}
