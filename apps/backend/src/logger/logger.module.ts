import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WinstonModule } from "nest-winston";

import { EnvironmentVariables } from "../config/environment.variables";
import { AppLoggerService } from "./app-logger.service";
import { buildWinstonOptions } from "./winston.config";

/**
 * Global so every module can inject AppLoggerService without repeating an
 * import. Logging is genuinely cross-cutting; this is one of the few cases
 * where @Global() is justified rather than a shortcut.
 */
@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) =>
        buildWinstonOptions({
          NODE_ENV: configService.get("NODE_ENV", { infer: true }),
          LOG_LEVEL: configService.get("LOG_LEVEL", { infer: true }),
        }),
    }),
  ],
  providers: [AppLoggerService],
  exports: [AppLoggerService],
})
export class LoggerModule {}
