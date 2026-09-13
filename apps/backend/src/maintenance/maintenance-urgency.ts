import { Maintenance, MaintenanceStatus } from "@prisma/client";

/**
 * How pressing one maintenance record is today.
 *
 * THE single rule behind the Dashboard's maintenance list and every
 * maintenance screen. Nothing else in the system decides "te laat" or
 * "vandaag", and no client re-derives it: every response carries the answer.
 *
 * ── WHICH DATE ──────────────────────────────────────────────────────────────
 * `maintenanceDate` is "the day the work was done, or is planned for". For a
 * PLANNED record that is the day it is planned for — the record's current
 * planning. Completing a record moves exactly that date on to the next one, so
 * it is always the date that matters.
 *
 * `nextMaintenanceDate` is deliberately NOT read. On a PLANNED record it is the
 * plan for the maintenance AFTER this one, and warning on it would warn twice
 * for one cycle, or about work that is not due yet.
 *
 * ── WHICH STATUS ────────────────────────────────────────────────────────────
 * Only PLANNED is open work waiting for its date. COMPLETED and CANCELLED are
 * never outstanding. IN_PROGRESS is work that has already started: it is not
 * waiting for a date, and the application has never treated it as a separate
 * kind of warning, so it has none.
 *
 * ── WHAT IS NEVER READ ──────────────────────────────────────────────────────
 * Mileage. `mileage` and `nextMaintenanceMileage` are administrative values the
 * Administrator typed; the system knows no current odometer reading, so no
 * kilometre figure can make maintenance due. The function does not even accept
 * them.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const MaintenanceUrgencyLevel = {
  /** Planned for a day that has passed. */
  OVERDUE: "OVERDUE",
  /** Planned for today. */
  TODAY: "TODAY",
  /** Planned for a day still to come. */
  UPCOMING: "UPCOMING",
} as const;

export type MaintenanceUrgencyLevel =
  (typeof MaintenanceUrgencyLevel)[keyof typeof MaintenanceUrgencyLevel];

export interface MaintenanceUrgency {
  readonly level: MaintenanceUrgencyLevel;
  /** Calendar days past the planned date. Zero unless OVERDUE. */
  readonly daysOverdue: number;
}

/** The only status that is open work waiting for its date. */
export const OUTSTANDING_STATUS = MaintenanceStatus.PLANNED;

/** What a completion may close: planned work, and work already under way. */
export const COMPLETABLE_STATUSES: readonly MaintenanceStatus[] = [
  MaintenanceStatus.PLANNED,
  MaintenanceStatus.IN_PROGRESS,
];

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * The urgency of `record` on `today`, or null when it is not outstanding.
 *
 * Both dates are UTC midnights — DATE columns carry no timezone, and neither
 * does `todayUtc` — so their difference is a whole number of calendar days.
 */
export function maintenanceUrgency(
  record: Pick<Maintenance, "status" | "maintenanceDate">,
  today: Date,
): MaintenanceUrgency | null {
  if (record.status !== OUTSTANDING_STATUS) {
    return null;
  }

  const daysPast = Math.round(
    (today.getTime() - record.maintenanceDate.getTime()) / MILLISECONDS_PER_DAY,
  );

  if (daysPast > 0) {
    return { level: MaintenanceUrgencyLevel.OVERDUE, daysOverdue: daysPast };
  }

  return daysPast === 0
    ? { level: MaintenanceUrgencyLevel.TODAY, daysOverdue: 0 }
    : { level: MaintenanceUrgencyLevel.UPCOMING, daysOverdue: 0 };
}
