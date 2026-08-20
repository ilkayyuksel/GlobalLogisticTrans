import { Trip } from "@prisma/client";

import { DriverStatisticsService } from "./driver-statistics.service";
import { DriverStatisticsDto } from "./dto/driver-statistics-response.dto";
import { EffectiveDriverSource } from "./dto/trip-response.dto";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { DriverService } from "../drivers/driver.service";

/**
 * Trips per Driver, for the Dashboard.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 *   1. the counts follow the EFFECTIVE driver, never the raw override column —
 *      a Trip with no override belongs to whoever the truck was assigned to on
 *      that day;
 *   2. the three windows are the ones the rest of TRAXO uses: today, the
 *      Monday-to-Sunday week, the calendar month;
 *   3. the cost is a fixed number of queries, never one per driver or per Trip.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Today is pinned so the windows are facts rather than whatever day the suite
 * happens to run on: Thursday 20 August 2026, in a week that runs Mon 17 to
 * Sun 23 and a month that runs 1 to 31 August.
 */

const TODAY = "2026-08-20";
const PIET = "11111111-1111-4111-8111-111111111111";
const AHMET = "22222222-2222-4222-8222-222222222222";
const RETIRED = "33333333-3333-4333-8333-333333333333";

const NAMES: Record<string, string> = {
  [PIET]: "Piet Janssens",
  [AHMET]: "Ahmet Yilmaz",
  [RETIRED]: "Marc Vermeulen",
};

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function trip(id: string, planningDate: string): Trip {
  return { id, planningDate: day(planningDate) } as unknown as Trip;
}

/** What the resolver answers: the driver each Trip really belongs to. */
function drivenBy(entries: Record<string, string | null>) {
  return new Map(
    Object.entries(entries).map(([tripId, driverId]) => [
      tripId,
      {
        vehicle: null,
        customProperties: [],
        effectiveDriver: driverId
          ? {
              id: driverId,
              name: NAMES[driverId],
              isActive: driverId !== RETIRED,
              source: EffectiveDriverSource.VehicleAssignment,
            }
          : null,
      },
    ]),
  );
}

describe("DriverStatisticsService", () => {
  let tripRepository: { findByPlanningDateRange: jest.Mock };
  let planningData: { resolveMany: jest.Mock };
  let driverService: { findAll: jest.Mock };
  let service: DriverStatisticsService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T09:30:00.000Z`));

    tripRepository = {
      findByPlanningDateRange: jest.fn().mockResolvedValue([]),
    };
    planningData = { resolveMany: jest.fn().mockResolvedValue(new Map()) };
    driverService = {
      findAll: jest.fn().mockResolvedValue({
        items: [
          { id: PIET, name: NAMES[PIET], isActive: true },
          { id: AHMET, name: NAMES[AHMET], isActive: true },
        ],
        meta: { page: 1, pageSize: 200, totalItems: 2, totalPages: 1 },
      }),
    };

    service = new DriverStatisticsService(
      tripRepository as unknown as TripRepository,
      planningData as unknown as TripPlanningDataService,
      driverService as unknown as DriverService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function withTrips(trips: Trip[], resolved: Record<string, string | null>) {
    tripRepository.findByPlanningDateRange.mockResolvedValue(trips);
    planningData.resolveMany.mockResolvedValue(drivenBy(resolved));
  }

  function countsFor(result: DriverStatisticsDto, id: string) {
    return result.drivers.find((entry) => entry.driverId === id);
  }

  it("counts a Trip under the driver the planning data resolved", async () => {
    withTrips([trip("t1", TODAY)], { t1: PIET });

    const result = await service.findAll();

    expect(countsFor(result, PIET)).toMatchObject({
      today: 1,
      week: 1,
      month: 1,
    });
  });

  /**
   * The whole reason this is not a `GROUP BY driver_id`: most Trips carry no
   * override, and counting that column would report almost nobody.
   */
  it("never reads the Trip's own driver column", async () => {
    const overridden = {
      ...trip("t1", TODAY),
      driverId: AHMET,
    } as unknown as Trip;

    // The resolver says PIET — an assignment — while the column says AHMET.
    withTrips([overridden], { t1: PIET });

    const result = await service.findAll();

    expect(countsFor(result, PIET)?.today).toBe(1);
    expect(countsFor(result, AHMET)?.today).toBe(0);
  });

  it("counts a Trip with no effective driver under nobody", async () => {
    withTrips([trip("t1", TODAY), trip("t2", TODAY)], { t1: PIET, t2: null });

    const result = await service.findAll();

    expect(countsFor(result, PIET)?.today).toBe(1);
    // No invented "unassigned" row appears beside the real drivers.
    expect(result.drivers).toHaveLength(2);
    expect(
      result.drivers.reduce((total, entry) => total + entry.today, 0),
    ).toBe(1);
  });

  describe("the three windows", () => {
    it("separates today, this week and this month", async () => {
      withTrips(
        [
          trip("today", TODAY),
          trip("monday", "2026-08-17"),
          trip("sunday", "2026-08-23"),
          trip("earlier", "2026-08-03"),
        ],
        { today: PIET, monday: PIET, sunday: PIET, earlier: PIET },
      );

      const result = await service.findAll();

      expect(countsFor(result, PIET)).toMatchObject({
        today: 1,
        week: 3,
        month: 4,
      });
    });

    it("uses a Monday-to-Sunday week, like the rest of TRAXO", async () => {
      const result = await service.findAll();

      expect(result.period).toMatchObject({
        today: TODAY,
        weekStart: "2026-08-17",
        weekEnd: "2026-08-23",
        monthStart: "2026-08-01",
        monthEnd: "2026-08-31",
      });
    });

    it("excludes the day before the week and the day after it", async () => {
      withTrips([trip("before", "2026-08-16"), trip("after", "2026-08-24")], {
        before: PIET,
        after: PIET,
      });

      const result = await service.findAll();

      expect(countsFor(result, PIET)).toMatchObject({
        today: 0,
        week: 0,
        month: 2,
      });
    });

    /**
     * The read has to cover the union of the windows, not just the month: the
     * week containing today can begin in the previous month, and reading only
     * the month would undercount it.
     */
    it("reads a range wide enough for a week that crosses the month", async () => {
      jest.setSystemTime(new Date("2026-09-02T09:30:00.000Z"));

      await service.findAll();

      const [from, to] = tripRepository.findByPlanningDateRange.mock.calls[0];

      // Monday 31 August: before the month the statistics are about.
      expect(from).toEqual(day("2026-08-31"));
      expect(to).toEqual(day("2026-09-30"));
    });
  });

  describe("which drivers are listed", () => {
    it("lists every active driver, including one with no work yet", async () => {
      const result = await service.findAll();

      expect(result.drivers.map((entry) => entry.driverId).sort()).toEqual(
        [PIET, AHMET].sort(),
      );
      expect(countsFor(result, AHMET)).toMatchObject({ today: 0, month: 0 });
    });

    /**
     * An inactive driver who drove this month must still be counted, or the
     * month's totals would disagree with the month's list.
     */
    it("adds an inactive driver who still has Trips in the window", async () => {
      withTrips([trip("t1", "2026-08-05")], { t1: RETIRED });

      const result = await service.findAll();

      expect(countsFor(result, RETIRED)).toMatchObject({
        driverName: "Marc Vermeulen",
        isActive: false,
        month: 1,
      });
    });

    it("puts the busiest month first", async () => {
      withTrips(
        [trip("a", TODAY), trip("b", "2026-08-04"), trip("c", "2026-08-05")],
        { a: AHMET, b: PIET, c: PIET },
      );

      const result = await service.findAll();

      expect(result.drivers.map((entry) => entry.driverName)).toEqual([
        "Piet Janssens",
        "Ahmet Yilmaz",
      ]);
    });
  });

  /**
   * The Dashboard shows one row per driver, and the cost must not follow that
   * number. One Trip read, one driver read, one resolve — whatever the fleet.
   */
  it("costs the same whether there are two drivers or twenty", async () => {
    withTrips(
      Array.from({ length: 40 }, (_, index) => trip(`t${index}`, TODAY)),
      Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [`t${index}`, PIET]),
      ),
    );

    await service.findAll();

    expect(tripRepository.findByPlanningDateRange).toHaveBeenCalledTimes(1);
    expect(driverService.findAll).toHaveBeenCalledTimes(1);
    expect(planningData.resolveMany).toHaveBeenCalledTimes(1);
  });

  it("excludes DELETED Trips, exactly as the planning list does", async () => {
    await service.findAll();

    const [, , excluded] = tripRepository.findByPlanningDateRange.mock.calls[0];

    expect(excluded).toEqual(["DELETED"]);
  });
});
