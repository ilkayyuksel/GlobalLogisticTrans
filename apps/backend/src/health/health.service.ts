import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";

export type DependencyStatus = "up" | "down";

export interface HealthReport {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  database: DependencyStatus;
}

/**
 * Reports whether the service and its dependencies are usable.
 *
 * Intended for container orchestrators and uptime monitors, so it stays cheap:
 * a single trivial round-trip rather than a full diagnostic sweep.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(HealthService.name);
  }

  async check(): Promise<HealthReport> {
    const database = await this.checkDatabase();

    return {
      status: database === "up" ? "ok" : "degraded",
      uptimeSeconds: Math.floor(process.uptime()),
      database,
    };
  }

  /**
   * Reports "down" instead of rethrowing: a health endpoint that returns a
   * useful body is more actionable than one that returns a stack trace.
   */
  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "up";
    } catch (error: unknown) {
      this.logger.error("Database health check failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return "down";
    }
  }
}
