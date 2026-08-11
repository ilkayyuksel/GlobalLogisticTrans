import { Module } from "@nestjs/common";

import { DriverModule } from "../drivers/driver.module";
import { VehicleModule } from "../vehicles/vehicle.module";
import { TripController } from "./trip.controller";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * PrismaModule and LoggerModule are global, so only the two modules whose
 * services are called directly are imported.
 *
 * VehicleModule and DriverModule are imported to reuse their existence lookups
 * and their active-state, rather than reading the vehicle and driver tables
 * from this module's repository. Dependencies flow one way: neither of them
 * knows about Trip, so no cycle can form.
 *
 * TripService is exported because later phases — pricing, export and the
 * parser — read Trips through the service, never through the repository, so
 * database access stays behind a single door.
 */
@Module({
  imports: [VehicleModule, DriverModule],
  controllers: [TripController],
  providers: [TripService, TripRepository],
  exports: [TripService],
})
export class TripModule {}
