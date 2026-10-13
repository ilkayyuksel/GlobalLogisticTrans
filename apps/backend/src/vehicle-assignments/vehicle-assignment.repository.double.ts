import { Driver, Trip, TripDriverSource, TripStatus, VehicleAssignment } from "@prisma/client";

import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";

/**
 * The assignment table, in memory.
 *
 * Faithful to the queries the real repository issues — in particular the
 * overlap predicate, since "does this period collide" is the rule that decides
 * whether a reassignment is allowed at all. It stores rows and answers
 * questions; every decision stays in the service, where it belongs.
 */
export class InMemoryAssignmentRepository {
  readonly rows: VehicleAssignment[] = [];
  /** Trips the assignment side may pin a driver on. */
  readonly trips: Trip[] = [];
  private sequence = 0;

  constructor(private readonly driverOf: (id: string) => Driver) {}

  runInTransaction<TResult>(
    work: (repository: VehicleAssignmentRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this as unknown as VehicleAssignmentRepository);
  }

  findById(id: string): Promise<VehicleAssignment | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  findOpenEndedForVehicle(vehicleId: string): Promise<VehicleAssignment | null> {
    return Promise.resolve(
      this.rows.find(
        (row) => row.vehicleId === vehicleId && row.validTo === null,
      ) ?? null,
    );
  }

  findOpenEndedForDriver(driverId: string): Promise<VehicleAssignment | null> {
    return Promise.resolve(
      this.rows.find((row) => row.driverId === driverId && row.validTo === null) ??
        null,
    );
  }

  /** Two periods overlap unless one ends before the other starts. */
  findOverlapping(query: {
    vehicleId?: string;
    driverId?: string;
    validFrom: Date;
    validTo: Date | null;
    excludeAssignmentId?: string;
  }): Promise<VehicleAssignment[]> {
    return Promise.resolve(
      this.rows.filter((row) => {
        if (query.vehicleId && row.vehicleId !== query.vehicleId) return false;
        if (query.driverId && row.driverId !== query.driverId) return false;
        if (query.excludeAssignmentId === row.id) return false;

        const startsAfterCandidateEnds =
          query.validTo !== null &&
          row.validFrom.getTime() > query.validTo.getTime();
        const endsBeforeCandidateStarts =
          row.validTo !== null &&
          row.validTo.getTime() < query.validFrom.getTime();

        return !startsAfterCandidateEnds && !endsBeforeCandidateStarts;
      }),
    );
  }

  findCoveringVehicles(
    vehicleIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<(VehicleAssignment & { driver: Driver })[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            vehicleIds.includes(row.vehicleId) &&
            row.validFrom.getTime() <= to.getTime() &&
            (row.validTo === null || row.validTo.getTime() >= from.getTime()),
        )
        .map((row) => ({ ...row, driver: this.driverOf(row.driverId) })),
    );
  }

  create(data: {
    vehicleId: string;
    driverId: string;
    validFrom: Date;
    validTo: Date | null;
    notes: string | null;
  }): Promise<VehicleAssignment> {
    this.sequence += 1;

    const row = {
      id: `assignment-${this.sequence}`,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as VehicleAssignment;

    this.rows.push(row);

    return Promise.resolve(row);
  }

  update(
    id: string,
    data: { validTo?: Date | null; notes?: string | null },
  ): Promise<VehicleAssignment> {
    const row = this.require(id);

    if (data.validTo !== undefined) row.validTo = data.validTo;
    if (data.notes !== undefined) row.notes = data.notes;

    return Promise.resolve(row);
  }

  setValidTo(id: string, validTo: Date | null): Promise<VehicleAssignment> {
    const row = this.require(id);
    row.validTo = validTo;

    return Promise.resolve(row);
  }

  /** The real filter: this vehicle, CLOSED, no stored driver, planned in [from, to]. */
  pinDriverOnUnpinnedTrips(query: {
    vehicleId: string;
    driverId: string;
    from: Date;
    to: Date | null;
  }): Promise<number> {
    let count = 0;

    for (const trip of this.trips) {
      const planned = trip.planningDate?.getTime();
      const inRange =
        planned !== undefined &&
        planned >= query.from.getTime() &&
        (query.to === null || planned <= query.to.getTime());

      if (
        trip.vehicleId === query.vehicleId &&
        trip.driverId === null &&
        trip.status === TripStatus.CLOSED &&
        inRange
      ) {
        trip.driverId = query.driverId;
        trip.driverSource = TripDriverSource.AUTOMATIC;
        count += 1;
      }
    }

    return Promise.resolve(count);
  }

  findPage(): Promise<{ items: VehicleAssignment[]; totalItems: number }> {
    return Promise.resolve({ items: [...this.rows], totalItems: this.rows.length });
  }

  findCurrentForVehicle(): Promise<VehicleAssignment | null> {
    return Promise.resolve(null);
  }

  findCurrentForDriver(): Promise<VehicleAssignment | null> {
    return Promise.resolve(null);
  }

  private require(id: string): VehicleAssignment {
    const row = this.rows.find((candidate) => candidate.id === id);

    if (!row) {
      throw new Error(`No assignment ${id}`);
    }

    return row;
  }
}
