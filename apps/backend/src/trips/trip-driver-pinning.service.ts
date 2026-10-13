import { Injectable } from "@nestjs/common";
import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  VehicleAssignmentService,
  assignmentKey,
} from "../vehicle-assignments/vehicle-assignment.service";

/** Where a Trip goes: its vehicle and its date. */
export interface TripDriverSlot {
  readonly vehicleId: string | null;
  readonly planningDate: Date | null;
}

/**
 * Keeps the driver of FINISHED work — and of nothing else.
 *
 * ── THREE DIFFERENT THINGS ──────────────────────────────────────────────────
 *   the CURRENT driver of a vehicle   — the assignment in effect today;
 *   the driver OF A TRIP              — `trip.driverId` when stored, otherwise
 *                                       its vehicle's driver on its planning
 *                                       date (`TripPlanningDataService`);
 *   the ASSIGNMENT HISTORY            — every `vehicle_assignment` row.
 *
 * ── THE OWNER'S RULE (13 October 2026) ──────────────────────────────────────
 * A Trip NOT yet finished stores no driver of its own unless one was chosen
 * for it (MANUAL): it follows whoever drives its vehicle on its date, so a new
 * driver on the truck reaches every such Trip in that driver's period.
 *
 * A FINISHED (CLOSED) Trip keeps the driver it had. Its answer would move only
 * when its vehicle or date changes — handled here — or when the assignment
 * covering its date is ended or replaced — handled by `cutOffAssignment`.
 * Either way the driver it showed is stored first, as AUTOMATIC. When the Trip
 * is reopened, that AUTOMATIC driver is released again (`TripRepository.setStatus`).
 *
 * This REPLACES the rule of 11 October, which stored the driver at planning
 * time for every Trip and so froze unfinished work on the old driver.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class TripDriverPinningService {
  constructor(
    private readonly assignments: VehicleAssignmentService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripDriverPinningService.name);
  }

  /**
   * The driver a CLOSED Trip storing none must keep before its vehicle or date
   * moves to `after`; undefined when there is nothing to keep.
   */
  async driverToKeep(before: Trip, after: TripDriverSlot): Promise<string | undefined> {
    const moves =
      before.vehicleId !== after.vehicleId ||
      before.planningDate?.getTime() !== after.planningDate?.getTime();

    if (before.status !== TripStatus.CLOSED || before.driverId !== null || !moves) {
      return undefined;
    }

    return this.driverOf(before);
  }

  private async driverOf(slot: TripDriverSlot): Promise<string | undefined> {
    if (slot.vehicleId === null || slot.planningDate === null) {
      return undefined;
    }

    const drivers = await this.assignments.findDriversForVehiclesOnDates([
      { vehicleId: slot.vehicleId, onDate: slot.planningDate },
    ]);

    return drivers.get(assignmentKey(slot.vehicleId, slot.planningDate))?.id;
  }
}
