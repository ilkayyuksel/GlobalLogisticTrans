import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { HealthReport, HealthService } from "./health.service";

/**
 * Version-neutral and outside the global prefix, so the probe URL stays exactly
 * /health. Orchestrators and uptime monitors are configured once and must not
 * have to follow API versioning.
 */
@ApiTags("Health")
@Controller({ path: "health", version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Liveness and dependency check.
   *
   * Always answers 200 so the response body — not the status code — carries the
   * detail. An orchestrator that only reads the status code still sees a
   * reachable process, which is exactly what a liveness probe asks.
   */
  @Get()
  @ApiOperation({ summary: "Service and dependency health" })
  @ApiOkResponse({ description: "Current health report" })
  check(): Promise<HealthReport> {
    return this.healthService.check();
  }
}
