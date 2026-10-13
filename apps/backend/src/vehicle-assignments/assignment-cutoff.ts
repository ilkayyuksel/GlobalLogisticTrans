import { VehicleAssignment } from "@prisma/client";

import { addDays } from "../common/dates";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";

export interface AssignmentCutoff {
  readonly ended: VehicleAssignment;
  /** Its new last day; before `validFrom` when it was never in effect. */
  readonly lastDay: Date;
  readonly neverInEffect: boolean;
  /** Trips that kept this assignment's driver because they stored none. */
  readonly pinnedTrips: number;
}

/**
 * Whether an assignment was ended before it ever began.
 *
 * Ending or replacing an assignment on the day it starts leaves it with
 * `validTo = validFrom − 1`: kept as history, in effect on no day at all
 * (`isInEffectOn` needs `validFrom <= day <= validTo`). The owner chose this
 * over deleting the row, because assignments are never deleted.
 */
export function isVoidAssignment(
  assignment: Pick<VehicleAssignment, "validFrom" | "validTo">,
): boolean {
  return (
    assignment.validTo !== null &&
    assignment.validTo.getTime() < assignment.validFrom.getTime()
  );
}

/** The last day an assignment keeps when it may not reach `firstDayWithout`. */
export function lastDayBefore(
  assignment: Pick<VehicleAssignment, "validFrom">,
  firstDayWithout: Date,
): Date {
  const start = Math.max(
    assignment.validFrom.getTime(),
    firstDayWithout.getTime(),
  );

  return addDays(new Date(start), -1);
}

/**
 * Ends `assignment` so it covers no day from `firstDayWithout` on.
 *
 * ── FINISHED TRIPS FIRST ────────────────────────────────────────────────────
 * A Trip that stores no driver shows its vehicle's driver on its planning
 * date. On the days this assignment gives up, a FINISHED (CLOSED) Trip would
 * silently move to whoever drives the truck next, so it is given the driver it
 * showed, as AUTOMATIC, before the period moves. A Trip not yet finished is
 * left alone and follows the new driver — the owner's rule of 13 October 2026.
 * A stored driver is never replaced. Both writes share the caller's
 * transaction.
 * ────────────────────────────────────────────────────────────────────────────
 */
export async function cutOffAssignment(
  repository: VehicleAssignmentRepository,
  assignment: VehicleAssignment,
  firstDayWithout: Date,
): Promise<AssignmentCutoff> {
  const validTo = lastDayBefore(assignment, firstDayWithout);
  const pinnedTrips = await repository.pinDriverOnUnpinnedTrips({
    vehicleId: assignment.vehicleId,
    driverId: assignment.driverId,
    from: addDays(validTo, 1),
    to: assignment.validTo,
  });
  const ended = await repository.setValidTo(assignment.id, validTo);

  return {
    ended,
    lastDay: validTo,
    neverInEffect: validTo.getTime() < assignment.validFrom.getTime(),
    pinnedTrips,
  };
}
