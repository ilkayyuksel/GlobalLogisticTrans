import { Injectable } from "@nestjs/common";
import { Driver, Prisma, VehicleAssignment } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

/** An assignment with the Driver it points at, loaded in the same query. */
export type AssignmentWithDriver = VehicleAssignment & { driver: Driver };

export interface FindAssignmentsFilter {
  vehicleId?: string;
  driverId?: string;
  /** Restricts to assignments in effect on `today`. */
  activeOn?: Date;
  /** Period the assignment must overlap. */
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

export interface AssignmentPage {
  items: VehicleAssignment[];
  totalItems: number;
}

export interface OverlapQuery {
  vehicleId?: string;
  driverId?: string;
  validFrom: Date;
  /** Null means the candidate period never ends. */
  validTo: Date | null;
  excludeAssignmentId?: string;
}

export type CreateAssignmentData = Prisma.VehicleAssignmentUncheckedCreateInput;
export type UpdateAssignmentData = Prisma.VehicleAssignmentUncheckedUpdateInput;

/**
 * Database access for the VehicleAssignment domain.
 *
 * Contains no business rules: overlap policy, auto-closing and error
 * translation all belong to VehicleAssignmentService. There is no delete
 * method, because assignments are never physically removed.
 */
@Injectable()
export class VehicleAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `work` against a transaction-scoped clone of this repository.
   *
   * The service never sees a Prisma client: it receives a repository bound to
   * the transaction, so the layering rule holds while create and end stay
   * atomic. The clone only ever uses the model delegate, which the transaction
   * client provides.
   */
  runInTransaction<TResult>(
    work: (repository: VehicleAssignmentRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction((transaction) =>
      work(
        new VehicleAssignmentRepository(transaction as unknown as PrismaService),
      ),
    );
  }

  /**
   * Page and count in one transaction so the total cannot drift from the rows
   * when a concurrent write lands between the two queries.
   */
  async findPage(filter: FindAssignmentsFilter): Promise<AssignmentPage> {
    const where = this.buildWhere(filter);

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.vehicleAssignment.findMany({
        where,
        orderBy: [{ validFrom: "desc" }, { id: "asc" }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.vehicleAssignment.count({ where }),
    ]);

    return { items, totalItems };
  }

  findById(id: string): Promise<VehicleAssignment | null> {
    return this.prisma.vehicleAssignment.findUnique({ where: { id } });
  }

  /**
   * Two periods overlap unless one ends before the other starts. A null end
   * means "never ends", so that side of the comparison is simply omitted.
   */
  findOverlapping(query: OverlapQuery): Promise<VehicleAssignment[]> {
    const where: Prisma.VehicleAssignmentWhereInput = {
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.excludeAssignmentId
        ? { id: { not: query.excludeAssignmentId } }
        : {}),
      AND: [
        // Existing must start on or before the candidate ends.
        ...(query.validTo ? [{ validFrom: { lte: query.validTo } }] : []),
        // Existing must end on or after the candidate starts.
        { OR: [{ validTo: null }, { validTo: { gte: query.validFrom } }] },
      ],
    };

    return this.prisma.vehicleAssignment.findMany({
      where,
      orderBy: { validFrom: "asc" },
    });
  }

  /** The open-ended assignment of a vehicle, if one exists. */
  findOpenEndedForVehicle(vehicleId: string): Promise<VehicleAssignment | null> {
    return this.prisma.vehicleAssignment.findFirst({
      where: { vehicleId, validTo: null },
    });
  }

  findOpenEndedForDriver(driverId: string): Promise<VehicleAssignment | null> {
    return this.prisma.vehicleAssignment.findFirst({
      where: { driverId, validTo: null },
    });
  }

  /** The assignment in effect for a vehicle on a given day. */
  findCurrentForVehicle(
    vehicleId: string,
    onDate: Date,
  ): Promise<VehicleAssignment | null> {
    return this.prisma.vehicleAssignment.findFirst({
      where: this.inEffectOn(onDate, { vehicleId }),
      orderBy: { validFrom: "desc" },
    });
  }

  findCurrentForDriver(
    driverId: string,
    onDate: Date,
  ): Promise<VehicleAssignment | null> {
    return this.prisma.vehicleAssignment.findFirst({
      where: this.inEffectOn(onDate, { driverId }),
      orderBy: { validFrom: "desc" },
    });
  }

  /**
   * Every assignment of these vehicles that could touch the given date span.
   *
   * ONE query for a whole page of Trips, which is what keeps driver resolution
   * off the N+1 path: a page of 25 Trips costs this single round trip rather
   * than 25 lookups.
   *
   * The date bounds are a FETCH BOUND, not the rule. They exist only to stop
   * this loading a vehicle's entire history; which assignment actually governs
   * a particular Trip is decided by `assignmentInEffect`, so the rule itself
   * stays in one place. A row returned here may well govern none of the Trips.
   *
   * The driver is included because the caller always needs the name, and a
   * second query to fetch drivers by id would reintroduce exactly the extra
   * round trip this method exists to avoid.
   */
  findCoveringVehicles(
    vehicleIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<AssignmentWithDriver[]> {
    if (vehicleIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.vehicleAssignment.findMany({
      where: {
        vehicleId: { in: [...vehicleIds] },
        validFrom: { lte: to },
        OR: [{ validTo: null }, { validTo: { gte: from } }],
      },
      include: { driver: true },
      orderBy: { validFrom: "desc" },
    });
  }

  create(data: CreateAssignmentData): Promise<VehicleAssignment> {
    return this.prisma.vehicleAssignment.create({ data });
  }

  update(id: string, data: UpdateAssignmentData): Promise<VehicleAssignment> {
    return this.prisma.vehicleAssignment.update({ where: { id }, data });
  }

  /** Sets the end date. Used both by the end endpoint and by auto-closing. */
  setValidTo(id: string, validTo: Date | null): Promise<VehicleAssignment> {
    return this.prisma.vehicleAssignment.update({
      where: { id },
      data: { validTo },
    });
  }

  private inEffectOn(
    onDate: Date,
    subject: Pick<Prisma.VehicleAssignmentWhereInput, "vehicleId" | "driverId">,
  ): Prisma.VehicleAssignmentWhereInput {
    return {
      ...subject,
      validFrom: { lte: onDate },
      OR: [{ validTo: null }, { validTo: { gte: onDate } }],
    };
  }

  private buildWhere(
    filter: FindAssignmentsFilter,
  ): Prisma.VehicleAssignmentWhereInput {
    const conditions: Prisma.VehicleAssignmentWhereInput[] = [];

    if (filter.activeOn) {
      conditions.push({
        validFrom: { lte: filter.activeOn },
        OR: [{ validTo: null }, { validTo: { gte: filter.activeOn } }],
      });
    }

    if (filter.to) {
      conditions.push({ validFrom: { lte: filter.to } });
    }

    if (filter.from) {
      conditions.push({
        OR: [{ validTo: null }, { validTo: { gte: filter.from } }],
      });
    }

    return {
      ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
      ...(filter.driverId ? { driverId: filter.driverId } : {}),
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    };
  }
}
