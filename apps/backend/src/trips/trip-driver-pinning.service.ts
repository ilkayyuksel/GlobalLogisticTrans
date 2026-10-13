import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  VehicleAssignmentService,
  assignmentKey,
} from "../vehicle-assignments/vehicle-assignment.service";

/** The three facts that decide a Trip's driver. */
export interface TripDriverSlot {
  readonly vehicleId: string | null;
  readonly planningDate: Date | null;
  readonly driverId: string | null;
}

/**
 * Keeps the driver a Trip was planned with — the owner's rule (October 2026).
 *
 * ── THREE DIFFERENT THINGS ──────────────────────────────────────────────────
 *   the CURRENT driver of a vehicle   — the assignment in effect today;
 *   the driver OF A TRIP              — `trip.driverId`, stored on the Trip;
 *   the ASSIGNMENT HISTORY            — every `vehicle_assignment` row.
 * A Trip with no stored driver still SHOWS the driver of its vehicle's
 * assignment on its planning date (`TripPlanningDataService`), but that answer
 * moves when the assignment or the date moves. So the Trip's driver is stored
 * at the moments it would otherwise move:
 *
 *   a Trip GIVEN a vehicle or a date — created with one, edited to one — and
 *     storing no driver yet gets the driver of that vehicle on that date;
 *   a Trip whose vehicle or date CHANGES, storing no driver yet, first keeps
 *     the driver it showed until now — a new date or another truck never hands
 *     its work to somebody else;
 *   a stored driver is never replaced here: only an explicit change of the
 *     Trip's own driver does that (and then nothing is pinned at all).
 *
 * The assignment side pins too, before it ends or replaces an assignment —
 * `VehicleAssignmentRepository.pinDriverOnUnpinnedTrips`.
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
   * The driver to store with a change, or undefined to leave the column alone.
   *
   * `before` is null for a Trip being created.
   */
  async driverToPin(
    before: TripDriverSlot | null,
    after: TripDriverSlot,
  ): Promise<string | undefined> {
    if (after.driverId !== null) {
      return undefined;
    }

    const moves =
      before !== null &&
      (before.vehicleId !== after.vehicleId ||
        before.planningDate?.getTime() !== after.planningDate?.getTime());

    // The driver it showed until now, kept through the move.
    if (moves && before.driverId === null) {
      const shown = await this.driverOf(before);

      if (shown) {
        return shown;
      }
    }

    // Given a vehicle and a date: the driver of that vehicle on that day.
    if (before === null || moves) {
      return this.driverOf(after);
    }

    return undefined;
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
