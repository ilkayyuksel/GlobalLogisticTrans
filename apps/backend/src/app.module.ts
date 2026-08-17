import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";

import { AuthModule } from "./auth/auth.module";
import { EventsModule } from "./common/events/events.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { validateEnvironment } from "./config/environment.variables";
import { CustomPropertyModule } from "./custom-properties/custom-property.module";
import { DriverModule } from "./drivers/driver.module";
import { HealthModule } from "./health/health.module";
import { ImapModule } from "./imap/imap.module";
import { LoggerModule } from "./logger/logger.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { PdfDocumentModule } from "./pdf-documents/pdf-document.module";
import { PdfImportModule } from "./pdf-import/pdf-import.module";
import { PricingEngineModule } from "./pricing-engine/pricing-engine.module";
import { PricingReprocessModule } from "./pricing-reprocess/pricing-reprocess.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RouteCostModule } from "./route-costs/route-cost.module";
import { RoutePricingModule } from "./route-pricing/route-pricing.module";
import { SettingsModule } from "./settings/settings.module";
import { TripCustomPropertyModule } from "./trip-custom-properties/trip-custom-property.module";
import { TripPricingItemModule } from "./trip-pricing-items/trip-pricing-item.module";
import { TripPricingModule } from "./trip-pricing/trip-pricing.module";
import { TripModule } from "./trips/trip.module";
import { VehicleAssignmentModule } from "./vehicle-assignments/vehicle-assignment.module";
import { VehicleModule } from "./vehicles/vehicle.module";

/**
 * Composition root.
 *
 * The filter and interceptor are registered through APP_FILTER / APP_INTERCEPTOR
 * rather than app.useGlobalFilters() in main.ts, because both depend on
 * AppLoggerService. Only the DI container can supply that; the imperative form
 * would force manual construction and defeat dependency injection.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // The repository root owns the single .env shared by every workspace app.
      envFilePath: ["../../.env"],
      validate: validateEnvironment,
    }),
    LoggerModule,
    // Registers the global access-token guard, so every controller below is
    // protected the moment it is added.
    AuthModule,
    // Provides SchedulerRegistry. It registers no jobs of its own — the mailbox
    // scan adds one at startup, and only when IMAP is enabled.
    ScheduleModule.forRoot(),
    EventsModule,
    PrismaModule,
    HealthModule,
    SettingsModule,
    DriverModule,
    VehicleModule,
    VehicleAssignmentModule,
    MaintenanceModule,
    RoutePricingModule,
    RouteCostModule,
    CustomPropertyModule,
    TripModule,
    TripPricingModule,
    TripPricingItemModule,
    TripCustomPropertyModule,
    PricingEngineModule,
    PricingReprocessModule,
    PdfDocumentModule,
    PdfImportModule,
    ImapModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
  ],
})
export class AppModule {}
