import { RequestMethod, ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import compression from "compression";
import helmet from "helmet";

import { AppModule } from "./app.module";
import {
  CORS_ALLOW_ALL,
  EnvironmentVariables,
  NodeEnvironment,
} from "./config/environment.variables";
import { SWAGGER_PATH, setupSwagger } from "./config/swagger.config";
import { AppLoggerService } from "./logger/app-logger.service";

/**
 * Every route is namespaced except the health probe, which orchestrators
 * expect at a fixed, unversioned path.
 */
const GLOBAL_PREFIX = "api";
const HEALTH_PATH = "health";

async function bootstrap(): Promise<void> {
  // bufferLogs holds startup messages until the Winston logger is available,
  // so boot output uses the same format as everything after it.
  const application = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = await application.resolve(AppLoggerService);
  logger.setContext("Bootstrap");
  application.useLogger(logger);

  const configService =
    application.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  const nodeEnvironment = configService.get("NODE_ENV", { infer: true });
  const port = configService.get("API_PORT", { infer: true });
  const corsOrigins = configService.get("CORS_ORIGINS", { infer: true });
  const isProduction = nodeEnvironment === NodeEnvironment.Production;

  application.setGlobalPrefix(GLOBAL_PREFIX, {
    exclude: [{ path: HEALTH_PATH, method: RequestMethod.GET }],
  });

  application.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });

  application.use(helmet());
  application.use(compression());

  const allowAllOrigins = corsOrigins.includes(CORS_ALLOW_ALL);

  if (allowAllOrigins && isProduction) {
    logger.warn(
      "CORS is open to every origin in production. Set CORS_ORIGINS to an explicit list.",
    );
  }

  application.enableCors({
    origin: allowAllOrigins ? true : corsOrigins,
    credentials: true,
  });

  application.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown properties and reject them, so a client cannot smuggle
      // fields past a DTO into a service.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (!isProduction) {
    setupSwagger(application);
  }

  application.enableShutdownHooks();

  await application.listen(port);

  logger.log(`Backend listening on port ${port} (${nodeEnvironment})`);
  logger.log(`Health endpoint: /${HEALTH_PATH}`);

  if (!isProduction) {
    logger.log(`API documentation: /${SWAGGER_PATH}`);
  }
}

// Nest cannot report a failure that happens before the app exists, so this is
// the one place a top-level catch is required.
void bootstrap().catch((error: unknown) => {
  console.error("Backend failed to start:", error);
  process.exit(1);
});
