import { Injectable } from "@nestjs/common";
import { Driver, Vehicle } from "@prisma/client";

import { todayUtc } from "../common/dates";
import { assignmentInEffect } from "./assignment-period";
import {
  VehicleAssignmentRepository,
  type AssignmentWithDriver,
  type AssignmentWithVehicle,
} from "./vehicle-assignment.repository";

/**
 * Who is driving what, TODAY.
 *
 * ── ONE SOURCE OF TRUTH, ASKED IN TWO DIRECTIONS ────────────────────────────
 * `VehicleAssignment` is the only place the vehicle ↔ driver relationship
 * lives. There is no `driverId` on Vehicle and no `vehicleId` on Driver, and
 * this service exists so there never needs to be: the Voertuigen list, the
 * Chauffeurs list and the Ritten vehicle picker all read the same rows through
 * the same period rule, so they cannot disagree about who is driving a truck.
 *
 * ── WHY NOT DERIVED FROM TRIPS ──────────────────────────────────────────────
 * A Trip records who drove it, which is a fact about a DAY. "The current
 * driver" is a fact about an assignment, and the two answer different
 * questions: a truck whose last Trip was in June has no June driver today, and
 * a truck assigned to somebody this morning has no Trip to prove it yet.
 * Nothing here reads a Trip.
 *
 * ── WHY IT DEPENDS ON NEITHER VEHICLES NOR DRIVERS ──────────────────────────
 * `VehicleAssignmentModule` imports both of those modules to validate its
 * writes, so neither of them can import it back without closing a cycle. This
 * module owns the READ side and depends on nothing but the repository, which is
 * what lets Vehicles, Drivers and Trips all reach it. It reads the related row
 * through Prisma's own `include` rather than through the other service, which
 * is also what keeps the whole thing to one query.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class CurrentAssignmentService {
  constructor(private readonly repository: VehicleAssignmentRepository) {}

  /**
   * The driver of each vehicle today, keyed by vehicle id.
   *
   * ONE query for the whole page. A vehicle with nobody assigned today is
   * simply absent from the map — that is how "no current driver" is expressed,
   * rather than by a null entry the caller has to distinguish.
   *
   * An INACTIVE driver is still returned, deliberately. Deactivating somebody
   * does not silently unassign the truck they are still down as driving; the
   * `isActive` flag travels with the answer so a caller can say so.
   */
  async findCurrentDriversForVehicles(
    vehicleIds: readonly string[],
    onDate: Date = todayUtc(),
  ): Promise<Map<string, Driver>> {
    const unique = [...new Set(vehicleIds)];

    if (unique.length === 0) {
      return new Map();
    }

    const assignments = await this.repository.findCoveringVehicles(
      unique,
      onDate,
      onDate,
    );

    return resolveByOwner(
      unique,
      assignments,
      (assignment) => assignment.vehicleId,
      (assignment) => (assignment as AssignmentWithDriver).driver,
      onDate,
    );
  }

  /** The vehicle each driver is assigned to today, keyed by driver id. */
  async findCurrentVehiclesForDrivers(
    driverIds: readonly string[],
    onDate: Date = todayUtc(),
  ): Promise<Map<string, Vehicle>> {
    const unique = [...new Set(driverIds)];

    if (unique.length === 0) {
      return new Map();
    }

    const assignments = await this.repository.findCoveringDrivers(
      unique,
      onDate,
      onDate,
    );

    return resolveByOwner(
      unique,
      assignments,
      (assignment) => assignment.driverId,
      (assignment) => (assignment as AssignmentWithVehicle).vehicle,
      onDate,
    );
  }
}

/**
 * Groups the fetched assignments by their owner and applies the period rule.
 *
 * The date bounds of the query are a fetch bound, not the rule: a row that came
 * back may still not govern today, and `assignmentInEffect` — the single
 * definition of "in effect", shared with the Trip driver resolution — is what
 * decides. Written once because the two directions differ only in which column
 * owns the row and which relation is wanted.
 */
function resolveByOwner<TRelated>(
  ownerIds: readonly string[],
  assignments: readonly (AssignmentWithDriver | AssignmentWithVehicle)[],
  ownerOf: (assignment: AssignmentWithDriver | AssignmentWithVehicle) => string,
  relatedOf: (
    assignment: AssignmentWithDriver | AssignmentWithVehicle,
  ) => TRelated,
  onDate: Date,
): Map<string, TRelated> {
  const byOwner = new Map<
    string,
    (AssignmentWithDriver | AssignmentWithVehicle)[]
  >();

  for (const assignment of assignments) {
    const owner = ownerOf(assignment);
    const known = byOwner.get(owner);

    if (known) {
      known.push(assignment);
    } else {
      byOwner.set(owner, [assignment]);
    }
  }

  const resolved = new Map<string, TRelated>();

  for (const ownerId of ownerIds) {
    const governing = assignmentInEffect(byOwner.get(ownerId) ?? [], onDate);

    if (governing) {
      resolved.set(
        ownerId,
        relatedOf(governing as AssignmentWithDriver | AssignmentWithVehicle),
      );
    }
  }

  return resolved;
}
