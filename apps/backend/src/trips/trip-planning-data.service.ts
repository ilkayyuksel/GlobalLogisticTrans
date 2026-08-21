import { Injectable } from "@nestjs/common";
import { Driver, Trip, Vehicle } from "@prisma/client";

import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { DriverService } from "../drivers/driver.service";
import {
  EffectiveDriverDto,
  EffectiveDriverSource,
  LatestTripUpdateDto,
  TripCustomPropertySummaryDto,
  TripPlanningData,
  TripVehicleSummaryDto,
} from "./dto/trip-response.dto";
import { TripRepository } from "./trip.repository";
import {
  VehicleAssignmentService,
  assignmentKey,
} from "../vehicle-assignments/vehicle-assignment.service";
import { VehicleService } from "../vehicles/vehicle.service";

/**
 * Resolves the Vehicle and the effective Driver of one or many Trips.
 *
 * This exists so the rule lives in exactly one place. A Trip's `driverId` is an
 * OVERRIDE, not "the driver": when it is null the driver comes from the
 * VehicleAssignment covering the Trip's planning date. Every client — the list,
 * the detail page, a future planning board — needs that answer, and none of
 * them may work it out for itself.
 *
 * The resolution, in order:
 *
 *   A. `trip.driverId` is set        → that Driver, source OVERRIDE
 *   B. no override, vehicle assigned → the Driver of the assignment covering
 *                                      `trip.planningDate`, source
 *                                      VEHICLE_ASSIGNMENT
 *   C. neither                       → null
 *
 * A Trip with no vehicle can still have an override: an unassigned Trip that a
 * planner has already given to someone is case A, not case C.
 *
 * ── ON QUERY COUNT ──────────────────────────────────────────────────────────
 * `resolveMany` costs a FIXED number of queries — at most four — regardless of
 * how many Trips it is given. It never loops over Trips issuing queries, which
 * is the whole reason it takes an array rather than being called per Trip.
 *
 * The Custom Properties are resolved here for the same reason: a list that
 * shows them would otherwise cost one request per row.
 */
@Injectable()
export class TripPlanningDataService {
  constructor(
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly vehicleAssignmentService: VehicleAssignmentService,
    private readonly tripRepository: TripRepository,
    private readonly costConfirmations: CostConfirmationService,
  ) {}

  /**
   * The Custom Properties of a page of Trips, keyed by Trip id.
   *
   * One query for the whole page. The property's own record travels on the
   * join row, so its name and active state cost nothing further.
   */
  private async resolveCustomProperties(
    tripIds: readonly string[],
  ): Promise<Map<string, TripCustomPropertySummaryDto[]>> {
    const byTrip = new Map<string, TripCustomPropertySummaryDto[]>();

    if (tripIds.length === 0) {
      return byTrip;
    }

    const assignments =
      await this.tripRepository.findCustomPropertiesForTrips(tripIds);

    for (const assignment of assignments) {
      const summaries = byTrip.get(assignment.tripId) ?? [];

      summaries.push({
        id: assignment.customProperty.id,
        name: assignment.customProperty.name,
        isActive: assignment.customProperty.isActive,
      });

      byTrip.set(assignment.tripId, summaries);
    }

    return byTrip;
  }

  /**
   * The most recent APPLIED update of each Trip, keyed by Trip id.
   *
   * One query for the whole page. An update writes one row PER CHANGED FIELD,
   * so "the latest update" is a group of rows sharing a document rather than a
   * single row — the rows are read newest-first and the first document seen for
   * a Trip is its latest update. Every row of that same document then
   * contributes its field.
   *
   * An update that changed nothing wrote one row with no field, and comes back
   * as an empty `changedFields`: it happened, and it moved nothing.
   */
  private async resolveLatestUpdates(
    tripIds: readonly string[],
  ): Promise<Map<string, LatestTripUpdateDto>> {
    const latest = new Map<string, LatestTripUpdateDto>();

    if (tripIds.length === 0) {
      return latest;
    }

    const events = await this.tripRepository.findAppliedUpdateHistory(tripIds);

    for (const event of events) {
      const known = latest.get(event.tripId);

      if (!known) {
        latest.set(event.tripId, {
          occurredAt: event.occurredAt,
          changedFields: fieldsOf(event.newValue),
          pdfDocumentId: event.pdfDocumentId,
        });

        continue;
      }

      /*
       * Same document as the one already taken: another field of the SAME
       * update. A row from an older update is ignored — its fields are not
       * what the latest update changed, and highlighting them would say that
       * every field ever touched had just moved.
       */
      if (known.pdfDocumentId !== null && known.pdfDocumentId === event.pdfDocumentId) {
        known.changedFields.push(...fieldsOf(event.newValue));
      }
    }

    return latest;
  }

  /** One Trip. Same rule, same code path — just a batch of one. */
  async resolveOne(trip: Trip): Promise<TripPlanningData> {
    const resolved = await this.resolveMany([trip]);

    return resolved.get(trip.id) ?? EMPTY_PLANNING_DATA;
  }

  /**
   * A whole page of Trips, keyed by Trip id.
   *
   * Four queries at most, whatever the page size: the vehicles, the override
   * drivers, the assignments covering the page's date span, and the Custom
   * Properties of every Trip on the page.
   */
  async resolveMany(trips: readonly Trip[]): Promise<Map<string, TripPlanningData>> {
    if (trips.length === 0) {
      return new Map();
    }

    const [
      vehicles,
      overrideDrivers,
      assignedDrivers,
      customProperties,
      latestUpdates,
      confirmations,
    ] = await Promise.all([
      this.loadVehicles(trips),
      this.loadOverrideDrivers(trips),
      this.loadAssignedDrivers(trips),
      this.resolveCustomProperties(trips.map((trip) => trip.id)),
      this.resolveLatestUpdates(trips.map((trip) => trip.id)),
      this.costConfirmations.findForTrips(trips.map((trip) => trip.id)),
    ]);

    const resolved = new Map<string, TripPlanningData>();

    for (const trip of trips) {
      resolved.set(trip.id, {
        vehicle: trip.vehicleId
          ? toVehicleSummary(vehicles.get(trip.vehicleId))
          : null,
        effectiveDriver: this.resolveDriver(trip, overrideDrivers, assignedDrivers),
        customProperties: customProperties.get(trip.id) ?? [],
        latestUpdate: latestUpdates.get(trip.id) ?? null,
        costConfirmation: confirmations.get(trip.id) ?? null,
      });
    }

    return resolved;
  }

  /**
   * The override wins whenever it is set — that is what makes it an override.
   * Only when it is absent does the vehicle's assignment answer.
   */
  private resolveDriver(
    trip: Trip,
    overrideDrivers: Map<string, Driver>,
    assignedDrivers: Map<string, Driver>,
  ): EffectiveDriverDto | null {
    if (trip.driverId) {
      const driver = overrideDrivers.get(trip.driverId);

      return driver
        ? toEffectiveDriver(driver, EffectiveDriverSource.Override)
        : null;
    }

    /*
     * A Trip planned onto no truck has no driver, and a Trip with no planning
     * date has no day on which to ask which driver was assigned. Both are
     * ordinary states of a manually created Trip, and both mean "nobody",
     * never "look it up some other way".
     */
    if (!trip.vehicleId || trip.planningDate === null) {
      return null;
    }

    const driver = assignedDrivers.get(
      assignmentKey(trip.vehicleId, trip.planningDate),
    );

    return driver
      ? toEffectiveDriver(driver, EffectiveDriverSource.VehicleAssignment)
      : null;
  }

  private async loadVehicles(
    trips: readonly Trip[],
  ): Promise<Map<string, Vehicle>> {
    const ids = distinct(trips.map((trip) => trip.vehicleId));

    return this.vehicleService.findManyByIds(ids);
  }

  private async loadOverrideDrivers(
    trips: readonly Trip[],
  ): Promise<Map<string, Driver>> {
    const ids = distinct(trips.map((trip) => trip.driverId));

    return this.driverService.findManyByIds(ids);
  }

  /**
   * The assignment-derived drivers, for the Trips that need one.
   *
   * Only Trips with a vehicle and no override are asked about: an override
   * already has its answer, and a Trip without a vehicle has no assignment to
   * consult.
   */
  private async loadAssignedDrivers(
    trips: readonly Trip[],
  ): Promise<Map<string, Driver>> {
    const requests = trips
      .filter(
        (trip) => !trip.driverId && trip.vehicleId && trip.planningDate !== null,
      )
      .map((trip) => ({
        vehicleId: trip.vehicleId as string,
        onDate: trip.planningDate as Date,
      }));

    return this.vehicleAssignmentService.findDriversForVehiclesOnDates(requests);
  }
}

const EMPTY_PLANNING_DATA: TripPlanningData = {
  vehicle: null,
  effectiveDriver: null,
  customProperties: [],
  latestUpdate: null,
  costConfirmation: null,
};

/**
 * The field a history row is about.
 *
 * A row stores `{ containerNumber: "XYZ456" }` — the field name is the key, so
 * the change set needs no second column to name it. A row with no value at all
 * is the marker for an update that changed nothing, and contributes no field.
 */
function fieldsOf(newValue: unknown): string[] {
  if (newValue === null || typeof newValue !== "object" || Array.isArray(newValue)) {
    return [];
  }

  return Object.keys(newValue as Record<string, unknown>);
}

function toVehicleSummary(
  vehicle: Vehicle | undefined,
): TripVehicleSummaryDto | null {
  if (!vehicle) {
    return null;
  }

  return {
    id: vehicle.id,
    licensePlate: vehicle.licensePlate,
    displayColor: vehicle.displayColor,
    isActive: vehicle.isActive,
  };
}

function toEffectiveDriver(
  driver: Driver,
  source: EffectiveDriverSource,
): EffectiveDriverDto {
  return {
    id: driver.id,
    name: driver.name,
    isActive: driver.isActive,
    source,
  };
}

/** The non-null ids, each once. */
function distinct(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}
