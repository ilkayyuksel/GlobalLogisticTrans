import { Module } from "@nestjs/common";

import { CustomPropertyModule } from "../custom-properties/custom-property.module";
import { TripModule } from "../trips/trip.module";
import { TripCustomPropertyController } from "./trip-custom-property.controller";
import { TripCustomPropertyRepository } from "./trip-custom-property.repository";
import { TripCustomPropertyService } from "./trip-custom-property.service";

/**
 * PrismaModule and LoggerModule are global, so only the two modules whose
 * services are called directly are imported.
 *
 * Both are read-only dependencies: TripModule supplies the Trip's existence
 * check and CustomPropertyModule the property's existence and active state.
 * Neither is written to from here — assigning a property must never modify the
 * Trip or the property itself.
 *
 * Dependencies flow one way: neither Trip nor CustomProperty knows about
 * assignments, so no cycle can form.
 *
 * TripCustomPropertyService is exported because the Pricing Engine needs it —
 * database_model.md §4.21 states the Engine reads a Trip's assignments to
 * decide which properties to include in a calculation. It reads them through
 * this service, never through the repository, so database access stays behind a
 * single door.
 */
@Module({
  imports: [TripModule, CustomPropertyModule],
  controllers: [TripCustomPropertyController],
  providers: [TripCustomPropertyService, TripCustomPropertyRepository],
  exports: [TripCustomPropertyService],
})
export class TripCustomPropertyModule {}
