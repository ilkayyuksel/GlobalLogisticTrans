import { Injectable } from "@nestjs/common";
import { MaintenanceStatus, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import {
  MaintenanceWithHistory,
  MaintenanceWithVehicle,
} from "./dto/maintenance-response.dto";
import {
  COMPLETABLE_STATUSES,
  OUTSTANDING_STATUS,
} from "./maintenance-urgency";

/** Everything a completion writes, decided by the service beforehand. */
export interface CompleteMaintenanceData {
  id: string;
  /**
   * The date the record was planned for when the service read it. The
   * completion applies only if the record still has it — see `complete`.
   */
  expectedPlannedDate: Date;
  completedOn: Date;
  nextMaintenanceDate: Date;
  notes: string | null;
  maintenanceType: string | null;
  description: string;
}

/** A record's history, oldest cycle first; registration order breaks ties. */
const COMPLETIONS_IN_ORDER = {
  orderBy: [
    { completedOn: "asc" },
    { createdAt: "asc" },
  ] satisfies Prisma.MaintenanceCompletionOrderByWithRelationInput[],
};

export type CreateMaintenanceData = Prisma.MaintenanceUncheckedCreateInput;
export type UpdateMaintenanceData = Prisma.MaintenanceUncheckedUpdateInput;

export interface FindMaintenanceFilter {
  vehicleId?: string;
  status?: MaintenanceStatus;
  maintenanceDateFrom?: Date;
  maintenanceDateTo?: Date;
  search?: string;
  /** Planned next date reached, and not cancelled. See the query DTO. */
  dueOn?: Date;
  skip: number;
  take: number;
}

export interface MaintenancePage {
  items: MaintenanceWithVehicle[];
  totalItems: number;
}

/**
 * Totals a Vehicle's maintenance, in the database.
 *
 * The sum in particular is deliberately not a JavaScript reduction: money is
 * NUMERIC(12,2), and Prisma returns a Decimal here.
 */
export interface MaintenanceTotals {
  maintenanceCount: number;
  totalCost: Prisma.Decimal | null;
}

/** Records that a summary counts. Cancelled work never happened. */
const SUMMARISED_STATUSES: readonly MaintenanceStatus[] = [
  MaintenanceStatus.PLANNED,
  MaintenanceStatus.IN_PROGRESS,
  MaintenanceStatus.COMPLETED,
];

/**
 * Database access for the Maintenance domain.
 *
 * No business rules and no delete: a maintenance record is history, and the
 * documented rule is that it is never removed. Cancelling is a status change
 * like any other update.
 */
@Injectable()
export class MaintenanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Page and count in one transaction so the total cannot drift from the rows
   * when a concurrent write lands between the two queries.
   */
  async findPage(filter: FindMaintenanceFilter): Promise<MaintenancePage> {
    const where = this.buildWhere(filter);

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.maintenance.findMany({
        where,
        include: { vehicle: true },
        // Newest first: a fleet list is read from the most recent work back.
        // The id breaks ties so paging stays stable across requests.
        orderBy: [{ maintenanceDate: "desc" }, { id: "asc" }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.maintenance.count({ where }),
    ]);

    return { items, totalItems };
  }

  /** One record, its Vehicle and its whole history, in one query. */
  findById(id: string): Promise<MaintenanceWithHistory | null> {
    return this.prisma.maintenance.findUnique({
      where: { id },
      include: { vehicle: true, completions: COMPLETIONS_IN_ORDER },
    });
  }

  /**
   * The outstanding maintenance most in need of attention, with its Vehicle.
   *
   * One query, ordered and limited by PostgreSQL. Ascending planned date IS the
   * priority: every overdue date sorts before today and today before any
   * future date, so this yields the overdue records oldest first, then today's,
   * then the upcoming ones soonest first. The id makes equal dates stable.
   *
   * Only the status and the date are read — no mileage, and not
   * `nextMaintenanceDate`, which on a PLANNED record is the cycle after this.
   */
  findAttention(take: number): Promise<MaintenanceWithVehicle[]> {
    return this.prisma.maintenance.findMany({
      where: { status: OUTSTANDING_STATUS },
      include: { vehicle: true },
      orderBy: [{ maintenanceDate: "asc" }, { id: "asc" }],
      take,
    });
  }

  /**
   * Completes the current cycle of one record and plans the SAME record again.
   *
   * One transaction, two writes and no new Maintenance row:
   *   1. the record moves to its next date and back to PLANNED — but only if
   *      it is still completable and still planned for the date the client
   *      named. A completion or an edit landing between the service's read and
   *      this write matches nothing. (A LATER request for the same cycle never
   *      gets here: the service refuses a planned date the record no longer has.)
   *   2. the cycle that ended is appended to the history.
   *
   * `nextMaintenanceDate` is set to the same date: the plan for the next
   * maintenance is now the record's own planning, and leaving the old value
   * would show a date nobody planned any more.
   *
   * Resolves null when step 1 matched nothing; nothing has been written then.
   */
  complete(data: CompleteMaintenanceData): Promise<MaintenanceWithHistory | null> {
    return this.prisma.$transaction(async (transaction) => {
      const replanned = await transaction.maintenance.updateMany({
        where: {
          id: data.id,
          status: { in: [...COMPLETABLE_STATUSES] },
          maintenanceDate: data.expectedPlannedDate,
        },
        data: {
          status: MaintenanceStatus.PLANNED,
          maintenanceDate: data.nextMaintenanceDate,
          nextMaintenanceDate: data.nextMaintenanceDate,
        },
      });

      if (replanned.count !== 1) {
        return null;
      }

      await transaction.maintenanceCompletion.create({
        data: {
          maintenanceId: data.id,
          plannedDate: data.expectedPlannedDate,
          completedOn: data.completedOn,
          nextMaintenanceDate: data.nextMaintenanceDate,
          notes: data.notes,
          maintenanceType: data.maintenanceType,
          description: data.description,
        },
      });

      return transaction.maintenance.findUnique({
        where: { id: data.id },
        include: { vehicle: true, completions: COMPLETIONS_IN_ORDER },
      });
    });
  }

  create(data: CreateMaintenanceData): Promise<MaintenanceWithVehicle> {
    return this.prisma.maintenance.create({ data, include: { vehicle: true } });
  }

  update(
    id: string,
    data: UpdateMaintenanceData,
  ): Promise<MaintenanceWithVehicle> {
    return this.prisma.maintenance.update({
      where: { id },
      data,
      include: { vehicle: true },
    });
  }

  /** Count and sum, computed by PostgreSQL over every matching row. */
  async totalsForVehicle(vehicleId: string): Promise<MaintenanceTotals> {
    const result = await this.prisma.maintenance.aggregate({
      where: { vehicleId, status: { in: [...SUMMARISED_STATUSES] } },
      _count: { _all: true },
      _sum: { cost: true },
    });

    return {
      maintenanceCount: result._count._all,
      totalCost: result._sum.cost,
    };
  }

  /** The most recent maintenance of a Vehicle, cancelled work aside. */
  findLatestForVehicle(vehicleId: string): Promise<MaintenanceWithVehicle | null> {
    return this.prisma.maintenance.findFirst({
      where: { vehicleId, status: { in: [...SUMMARISED_STATUSES] } },
      include: { vehicle: true },
      orderBy: [{ maintenanceDate: "desc" }, { id: "asc" }],
    });
  }

  /**
   * The most recent record that carries an odometer reading.
   *
   * Separate from `findLatestForVehicle` because the newest maintenance may
   * have none, and "the last reading we have" is still the honest answer.
   */
  findLatestWithMileageForVehicle(
    vehicleId: string,
  ): Promise<MaintenanceWithVehicle | null> {
    return this.prisma.maintenance.findFirst({
      where: {
        vehicleId,
        status: { in: [...SUMMARISED_STATUSES] },
        mileage: { not: null },
      },
      include: { vehicle: true },
      orderBy: [{ maintenanceDate: "desc" }, { id: "asc" }],
    });
  }

  /** The earliest planned next maintenance still outstanding. */
  findNextPlannedForVehicle(
    vehicleId: string,
  ): Promise<MaintenanceWithVehicle | null> {
    return this.prisma.maintenance.findFirst({
      where: {
        vehicleId,
        status: { in: [...SUMMARISED_STATUSES] },
        nextMaintenanceDate: { not: null },
      },
      include: { vehicle: true },
      orderBy: [{ nextMaintenanceDate: "asc" }],
    });
  }

  async vehicleExists(vehicleId: string): Promise<boolean> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true },
    });

    return vehicle !== null;
  }

  private buildWhere(
    filter: FindMaintenanceFilter,
  ): Prisma.MaintenanceWhereInput {
    return {
      ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...this.buildDateWhere(filter),
      ...this.buildDueWhere(filter),
      ...this.buildSearchWhere(filter.search),
    };
  }

  private buildDateWhere(
    filter: FindMaintenanceFilter,
  ): Prisma.MaintenanceWhereInput {
    if (!filter.maintenanceDateFrom && !filter.maintenanceDateTo) {
      return {};
    }

    return {
      maintenanceDate: {
        ...(filter.maintenanceDateFrom ? { gte: filter.maintenanceDateFrom } : {}),
        ...(filter.maintenanceDateTo ? { lte: filter.maintenanceDateTo } : {}),
      },
    };
  }

  /**
   * Due means: a planned next date exists and has arrived.
   *
   * Mileage is absent on purpose. Comparing `nextMaintenanceMileage` to
   * anything would require the vehicle's CURRENT odometer reading, which this
   * system does not have — and comparing it to the historical mileage on the
   * same record would answer a different question entirely.
   */
  private buildDueWhere(
    filter: FindMaintenanceFilter,
  ): Prisma.MaintenanceWhereInput {
    if (!filter.dueOn) {
      return {};
    }

    return {
      nextMaintenanceDate: { not: null, lte: filter.dueOn },
      status: { in: [...SUMMARISED_STATUSES] },
    };
  }

  private buildSearchWhere(search?: string): Prisma.MaintenanceWhereInput {
    if (!search) {
      return {};
    }

    const contains = { contains: search, mode: Prisma.QueryMode.insensitive };

    return {
      OR: [
        { description: contains },
        { workshop: contains },
        { maintenanceType: contains },
        { notes: contains },
      ],
    };
  }
}
