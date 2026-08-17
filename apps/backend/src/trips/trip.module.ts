import { Module } from "@nestjs/common";

import { DriverModule } from "../drivers/driver.module";
import { VehicleAssignmentModule } from "../vehicle-assignments/vehicle-assignment.module";
import { VehicleModule } from "../vehicles/vehicle.module";
import { TripController } from "./trip.controller";
import { TripGroupController } from "./trip-group.controller";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripRevisionService } from "./trip-revision.service";
import { TripService } from "./trip.service";

/**
 * PrismaModule and LoggerModule are global, so only the modules whose services
 * are called directly are imported.
 *
 * VehicleModule and DriverModule are imported to reuse their existence lookups
 * and their active-state, rather than reading the vehicle and driver tables
 * from this module's repository.
 *
 * VehicleAssignmentModule is imported so a Trip's EFFECTIVE driver can be
 * resolved here: the Trip's own driver column is only an override, and the
 * standing arrangement lives in an assignment. Dependencies still flow one
 * way — none of those three knows about Trip — so no cycle can form.
 *
 * TripService is exported because later phases — pricing, export and the
 * parser — read Trips through the service, never through the repository, so
 * database access stays behind a single door.
 */
@Module({
  imports: [VehicleModule, DriverModule, VehicleAssignmentModule],
  controllers: [TripController, TripGroupController],
  providers: [
    TripService,
    TripRevisionService,
    TripRepository,
    TripPlanningDataService,
  ],
  // TripRevisionService is exported for the import boundary: a cancellation or
  // a revision arrives as a document, and the rules for both live in the Trip
  // domain rather than in whichever transport carried the document.
  exports: [TripService, TripRevisionService],
})
export class TripModule {}
