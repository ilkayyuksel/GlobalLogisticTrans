import { Global, Module } from "@nestjs/common";

import { PrismaService } from "./prisma.service";

/**
 * Global so future feature modules can inject PrismaService in their
 * repositories without importing this module everywhere. A single shared
 * connection pool is also the reason this must not be instantiated per module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
