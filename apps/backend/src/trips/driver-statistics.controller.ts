import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { DriverStatisticsDto } from "./dto/driver-statistics-response.dto";
import { DriverStatisticsService } from "./driver-statistics.service";

/**
 * Returns plain data; ResponseInterceptor applies the envelope and
 * AllExceptionsFilter renders errors.
 *
 * A resource of its own rather than `/drivers/statistics` or
 * `/trips/driver-statistics`: it belongs to the Trip domain — it counts Trips —
 * but `/drivers/{id}` and `/trips/{id}` are both parameter routes that a
 * `statistics` segment would have to be ordered ahead of. A top-level noun
 * cannot be shadowed by anybody's id, and the Driver module stays free of a
 * dependency on Trips, which would close the one-way loop the modules keep.
 *
 * Read-only, and takes no parameters: the windows are today, this week and this
 * month, which only the server can decide truthfully.
 */
@ApiTags("Drivers")
@Controller("driver-statistics")
export class DriverStatisticsController {
  constructor(private readonly statisticsService: DriverStatisticsService) {}

  @Get()
  @ApiOperation({
    summary: "Trips per Driver for today, this week and this month",
    description:
      "Counts are taken over the EFFECTIVE driver of each Trip — the Trip's override when it has one, otherwise the Driver assigned to its vehicle on its planning date. A Trip with no effective driver is counted under nobody. DELETED Trips are excluded, exactly as they are in the planning list.",
  })
  @ApiOkResponse({ type: DriverStatisticsDto })
  findAll(): Promise<DriverStatisticsDto> {
    return this.statisticsService.findAll();
  }
}
