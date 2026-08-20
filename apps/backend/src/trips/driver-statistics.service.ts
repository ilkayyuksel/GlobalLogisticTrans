import { Injectable } from "@nestjs/common";
import { Trip, TripStatus } from "@prisma/client";

import {
  endOfMonthUtc,
  endOfWeekUtc,
  startOfMonthUtc,
  startOfWeekUtc,
  toIsoDate,
  todayUtc,
} from "../common/dates";
import { DriverService } from "../drivers/driver.service";
import { MAX_PAGE_SIZE } from "../common/dto/pagination-query.dto";
import {
  DriverStatisticsDto,
  DriverTripCountsDto,
} from "./dto/driver-statistics-response.dto";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";

/** DELETED Trips are hidden from planning, so they are not work anybody did. */
const HIDDEN_STATUSES: readonly TripStatus[] = [TripStatus.DELETED];

/**
 * How many Trips each Driver has today, this week and this month.
 *
 * ── WHY THIS IS NOT A GROUP BY ──────────────────────────────────────────────
 * A `GROUP BY driver_id` would count the OVERRIDE column, which is not the
 * driver of a Trip — it is the exception. Most Trips have no override and
 * belong to whoever the truck was assigned to on that day, so the honest count
 * has to resolve the effective driver first. `TripPlanningDataService` is the
 * one place that rule lives, and this asks it rather than restating it in SQL
 * where the two could quietly drift apart.
 *
 * ── WHY THAT IS STILL CHEAP ─────────────────────────────────────────────────
 * A FIXED number of queries, whatever the fleet size: the drivers, the Trips of
 * the window, and the four the resolver itself costs. Never one per driver and
 * never one per Trip. The window is one month plus the overhang of a week that
 * crosses a month boundary — a bounded slice of a family fleet's work, read
 * once and tallied in memory.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class DriverStatisticsService {
  constructor(
    private readonly tripRepository: TripRepository,
    private readonly planningData: TripPlanningDataService,
    private readonly driverService: DriverService,
  ) {}

  async findAll(): Promise<DriverStatisticsDto> {
    const today = todayUtc();
    const window = toWindow(today);

    const [trips, drivers] = await Promise.all([
      this.tripRepository.findByPlanningDateRange(
        window.from,
        window.to,
        HIDDEN_STATUSES,
      ),
      this.driverService.findAll({ page: 1, pageSize: MAX_PAGE_SIZE, isActive: true }),
    ]);

    const planning = await this.planningData.resolveMany(trips);

    const counts = new Map<string, DriverTripCountsDto>();

    for (const driver of drivers.items) {
      counts.set(driver.id, emptyCounts(driver.id, driver.name, driver.isActive));
    }

    for (const trip of trips) {
      const driver = planning.get(trip.id)?.effectiveDriver;

      /*
       * No effective driver means nobody drove it as far as this system knows —
       * an unplanned Trip, or a truck with no assignment on that day. It is
       * counted under no driver at all rather than under an invented one.
       */
      if (!driver || trip.planningDate === null) {
        continue;
      }

      /*
       * An INACTIVE driver still appears when they have work in the window:
       * they drove it, and hiding those Trips would make the month's counts
       * disagree with the month's list.
       */
      const entry =
        counts.get(driver.id) ??
        emptyCounts(driver.id, driver.name, driver.isActive);

      addTrip(entry, trip, window);
      counts.set(driver.id, entry);
    }

    return {
      period: {
        today: toIsoDate(today),
        weekStart: toIsoDate(window.weekStart),
        weekEnd: toIsoDate(window.weekEnd),
        monthStart: toIsoDate(window.monthStart),
        monthEnd: toIsoDate(window.monthEnd),
      },
      drivers: [...counts.values()].sort(byBusiestMonthThenName),
    };
  }
}

interface StatisticsWindow {
  readonly today: Date;
  readonly weekStart: Date;
  readonly weekEnd: Date;
  readonly monthStart: Date;
  readonly monthEnd: Date;
  /** The whole span to read, which is the union of the three windows. */
  readonly from: Date;
  readonly to: Date;
}

/**
 * The three windows, and the single range that covers all of them.
 *
 * The union is not always the month: the week containing today can start in the
 * previous month or end in the next one, and reading only the month would then
 * undercount the week.
 */
function toWindow(today: Date): StatisticsWindow {
  const weekStart = startOfWeekUtc(today);
  const weekEnd = endOfWeekUtc(today);
  const monthStart = startOfMonthUtc(today);
  const monthEnd = endOfMonthUtc(today);

  return {
    today,
    weekStart,
    weekEnd,
    monthStart,
    monthEnd,
    from: earliest(weekStart, monthStart),
    to: latest(weekEnd, monthEnd),
  };
}

function addTrip(
  entry: DriverTripCountsDto,
  trip: Trip,
  window: StatisticsWindow,
): void {
  const planningDate = trip.planningDate as Date;

  if (planningDate.getTime() === window.today.getTime()) {
    entry.today += 1;
  }

  if (isWithin(planningDate, window.weekStart, window.weekEnd)) {
    entry.week += 1;
  }

  if (isWithin(planningDate, window.monthStart, window.monthEnd)) {
    entry.month += 1;
  }
}

/** Both ends inclusive, like the planning-date range filter of the list. */
function isWithin(date: Date, from: Date, to: Date): boolean {
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
}

function earliest(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function latest(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function emptyCounts(
  driverId: string,
  driverName: string,
  isActive: boolean,
): DriverTripCountsDto {
  return { driverId, driverName, isActive, today: 0, week: 0, month: 0 };
}

/** Busiest month first; ties read alphabetically so the order is stable. */
function byBusiestMonthThenName(
  left: DriverTripCountsDto,
  right: DriverTripCountsDto,
): number {
  return (
    right.month - left.month || left.driverName.localeCompare(right.driverName)
  );
}
