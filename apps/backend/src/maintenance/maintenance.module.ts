import { Module } from "@nestjs/common";

import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceRepository } from "./maintenance.repository";
import { MaintenanceService } from "./maintenance.service";

/**
 * Fleet maintenance administration.
 *
 * PrismaModule and LoggerModule are global, so nothing needs importing. The
 * Vehicle existence check reads one column through this module's own
 * repository rather than importing VehicleModule: it is a foreign-key
 * question, not a Vehicle business rule, and the alternative is a module
 * dependency for a single `select id`.
 *
 * Nothing is exported. Maintenance is read and written through its own
 * endpoints; no other module needs it.
 */
@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService, MaintenanceRepository],
})
export class MaintenanceModule {}
