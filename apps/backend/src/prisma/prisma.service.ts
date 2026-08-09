import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { EnvironmentVariables } from "../config/environment.variables";
import { AppLoggerService } from "../logger/app-logger.service";

/**
 * The only component in the backend that talks to PostgreSQL.
 *
 * Extends PrismaClient so repositories can inject this service and use the
 * generated, fully typed query API directly — there is no value in hand-writing
 * a wrapper around every model.
 *
 * Prisma 7 no longer reads the connection URL from schema.prisma, so the driver
 * adapter is constructed here from validated configuration.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    configService: ConfigService<EnvironmentVariables, true>,
    private readonly logger: AppLoggerService,
  ) {
    const connectionString = configService.get("DATABASE_URL", {
      infer: true,
    });

    super({ adapter: new PrismaPg({ connectionString }) });

    this.logger.setContext(PrismaService.name);
  }

  /**
   * Connect eagerly rather than on first query, so a misconfigured database
   * fails the boot instead of the first incoming request.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Database connection established");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log("Database connection closed");
  }
}
