import { request } from "./client";

/**
 * How many Trips each driver has today, this week and this month.
 *
 * ── ONE REQUEST, AND EVERY NUMBER IS THE BACKEND'S ──────────────────────────
 * The counts are taken over the EFFECTIVE driver — the Trip's override when it
 * has one, otherwise the driver assigned to its vehicle on its planning date —
 * and that rule lives in the backend, in the same resolver the Trip list uses.
 * Nothing here resolves an assignment, counts a Trip or works out where the
 * week begins; doing any of that in the browser would be a second opinion about
 * the same facts.
 *
 * One call for the whole widget: never one per driver, and never a Trip list
 * that the browser then tallies.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface DriverTripCounts {
  driverId: string;
  driverName: string;
  isActive: boolean;
  today: number;
  week: number;
  month: number;
}

/** The windows the counts were taken over, as the backend decided them. */
export interface DriverStatisticsPeriod {
  today: string;
  weekStart: string;
  weekEnd: string;
  monthStart: string;
  monthEnd: string;
}

export interface DriverStatistics {
  period: DriverStatisticsPeriod;
  /** Busiest month first, as the backend ordered them. */
  drivers: DriverTripCounts[];
}

export function getDriverStatistics(
  signal?: AbortSignal,
): Promise<DriverStatistics> {
  return request<DriverStatistics>("/api/v1/driver-statistics", { signal });
}
