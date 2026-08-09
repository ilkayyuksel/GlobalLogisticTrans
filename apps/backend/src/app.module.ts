import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { validateEnvironment } from "./config/environment.variables";
import { DriverModule } from "./drivers/driver.module";
import { HealthModule } from "./health/health.module";
import { LoggerModule } from "./logger/logger.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SettingsModule } from "./settings/settings.module";
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
