import { DriverStatisticsController } from "./driver-statistics.controller";
import { DriverStatisticsService } from "./driver-statistics.service";
import { DriverStatisticsDto } from "./dto/driver-statistics-response.dto";

/**
 * The controller is a pass-through, and these tests keep it one: no counting,
 * no date arithmetic and no reshaping of what the service answered.
 */

const STATISTICS: DriverStatisticsDto = {
  period: {
    today: "2026-08-20",
    weekStart: "2026-08-17",
    weekEnd: "2026-08-23",
    monthStart: "2026-08-01",
    monthEnd: "2026-08-31",
  },
  drivers: [
    {
      driverId: "11111111-1111-4111-8111-111111111111",
      driverName: "Piet Janssens",
      isActive: true,
      today: 2,
      week: 8,
      month: 31,
    },
  ],
};

describe("DriverStatisticsController", () => {
  let service: { findAll: jest.Mock };
  let controller: DriverStatisticsController;

  beforeEach(() => {
    service = { findAll: jest.fn().mockResolvedValue(STATISTICS) };
    controller = new DriverStatisticsController(
      service as unknown as DriverStatisticsService,
    );
  });

  it("returns what the service answered, unchanged", async () => {
    await expect(controller.findAll()).resolves.toBe(STATISTICS);
  });

  /**
   * The windows are today, this week and this month — decided by the server
   * because only it can say truthfully what "today" is. Nothing is passed in,
   * so nothing can ask for a different period through this endpoint.
   */
  it("takes no parameters", async () => {
    await controller.findAll();

    expect(service.findAll).toHaveBeenCalledWith();
  });
});
