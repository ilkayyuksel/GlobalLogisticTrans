import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { validateEnvironment } from "./config/environment.variables";
import { CustomPropertyModule } from "./custom-properties/custom-property.module";
import { DriverModule } from "./drivers/driver.module";
import { HealthModule } from "./health/health.module";
import { LoggerModule } from "./logger/logger.module";
import { PricingEngineModule } from "./pricing-engine/pricing-engine.module";
import { PrismaModule } from "./prisma/prisma.module";
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
    PrismaModule,
    HealthModule,
    SettingsModule,
    DriverModule,
    VehicleModule,
    VehicleAssignmentModule,
    RoutePricingModule,
    CustomPropertyModule,
    TripModule,
    TripPricingModule,
    TripPricingItemModule,
    TripCustomPropertyModule,
    PricingEngineModule,
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
