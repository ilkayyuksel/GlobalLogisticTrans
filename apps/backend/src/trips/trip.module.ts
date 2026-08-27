import { Module } from "@nestjs/common";

import { CostConfirmationModule } from "../cost-confirmations/cost-confirmation.module";
import { CustomPropertyModule } from "../custom-properties/custom-property.module";
import { DriverModule } from "../drivers/driver.module";
import { VehicleAssignmentModule } from "../vehicle-assignments/vehicle-assignment.module";
import { VehicleModule } from "../vehicles/vehicle.module";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { DriverStatisticsController } from "./driver-statistics.controller";
import { DriverStatisticsService } from "./driver-statistics.service";
import { TripController } from "./trip.controller";
import { TripGroupController } from "./trip-group.controller";
import { TripDocumentsService } from "./trip-documents.service";
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
 * The Driver statistics live here rather than in the Driver module for the same
 * reason: they COUNT TRIPS, and resolving which Driver a Trip belongs to is the
 * planning-data rule this module already owns. Putting them the other way round
 * would make DriverModule depend on TripModule and close the loop.
 *
 * CustomPropertyModule is imported for one rule: a Trip whose container type
 * is 20FL or 20ST must carry the "Flat" property, and the rule resolves that
 * property by NAME through the Custom Property service rather than holding a
 * copy of its id. The dependency points the same way as the others — Custom
 * Property knows nothing about Trips — so no cycle forms. The assignment ROW is
 * written through a transaction-scoped repository handed out by
 * `runTripWriteTransaction`, so the Trip and its properties commit together.
 *
 * TripService is exported because later phases — pricing, export and the
 * parser — read Trips through the service, never through the repository, so
 * database access stays behind a single door.
 */
@Module({
  imports: [
    VehicleModule,
    DriverModule,
    VehicleAssignmentModule,
    CostConfirmationModule,
    CustomPropertyModule,
  ],
  controllers: [TripController, TripGroupController, DriverStatisticsController],
  providers: [
    AutomaticFlatPropertyService,
    DriverStatisticsService,
    TripService,
    TripRevisionService,
    TripRepository,
    TripPlanningDataService,
    TripDocumentsService,
  ],
  // TripRevisionService is exported for the import boundary: a cancellation or
  // a revision arrives as a document, and the rules for both live in the Trip
  // domain rather than in whichever transport carried the document.
  // TripDocumentsService is exported for the WhatsApp module: deciding WHICH
  // transport order to send a driver is a question about a Trip's document
  // history, and that history has exactly one owner.
  exports: [TripService, TripRevisionService, TripDocumentsService],
})
export class TripModule {}
