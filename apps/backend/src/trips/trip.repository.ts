import { Injectable } from "@nestjs/common";
import { Prisma, Trip, TripStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export interface FindTripsFilter {
  status?: TripStatus;
  /** Statuses to hide when no explicit status filter is supplied. */
  excludeStatuses?: readonly TripStatus[];
  planningDate?: Date;
  planningDateFrom?: Date;
  planningDateTo?: Date;
  bookingNumber?: string;
  containerNumber?: string;
  driverId?: string;
  vehicleId?: string;
  terminal?: string;
  destinationCity?: string;
  destinationCountry?: string;
  search?: string;
  skip: number;
  take: number;
}

export interface TripPage {
  items: Trip[];
  totalItems: number;
}

export interface BookingNumberQuery {
  bookingNumber: string;
  /** Only these statuses count as holding the booking number. */
  statuses: readonly TripStatus[];
  excludeTripId?: string;
}

export interface VehicleOverlapQuery {
  vehicleId: string;
  planningDate: Date;
  startTime: Date;
  endTime: Date;
  statuses: readonly TripStatus[];
  excludeTripId?: string;
}

export type CreateTripData = Prisma.TripUncheckedCreateInput;
export type UpdateTripData = Prisma.TripUncheckedUpdateInput;

/**
 * Database access for the Trip domain.
 *
 * Contains no business rules: status transitions, booking-number uniqueness,
 * assignment eligibility and overlap policy all belong to TripService. There is
 * no delete method, because Trips are never physically removed — deletion is
 * expressed as a status.
 */
@Injectable()
export class TripRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `work` against a transaction-scoped clone of this repository.
   *
   * The service never sees a Prisma client: it receives a repository bound to
   * the transaction, so the layering rule holds while a check and the write it
   * guards stay in one unit. The clone only ever uses the model delegate, which
   * the transaction client provides.
   */
  runInTransaction<TResult>(
    work: (repository: TripRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction((transaction) =>
      work(new TripRepository(transaction as unknown as PrismaService)),
    );
  }

  /**
   * Page and count in one transaction so the total cannot drift from the rows
   * when a concurrent write lands between the two queries.
   */
  async findPage(filter: FindTripsFilter): Promise<TripPage> {
    const where = this.buildWhere(filter);

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where,
        // Planning is read day by day, newest first; id breaks ties so paging
        // stays stable across requests.
        orderBy: [{ planningDate: "desc" }, { id: "asc" }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.trip.count({ where }),
    ]);

    return { items, totalItems };
  }

  findById(id: string): Promise<Trip | null> {
    return this.prisma.trip.findUnique({ where: { id } });
  }

  /** The Trip currently holding a booking number, if any. */
  findByBookingNumber(query: BookingNumberQuery): Promise<Trip | null> {
    return this.prisma.trip.findFirst({
      where: {
        bookingNumber: query.bookingNumber,
        status: { in: [...query.statuses] },
        ...(query.excludeTripId ? { id: { not: query.excludeTripId } } : {}),
      },
    });
  }

  /**
   * Trips whose planned interval collides with the candidate on the same day.
   *
   * Half-open comparison: two intervals overlap when each starts before the
   * other ends, so a Trip ending at 12:00 and one starting at 12:00 do not
   * collide. Trips without both times are excluded by the null checks, because
   * an unknown interval cannot be shown to overlap.
   */
  findVehicleOverlaps(query: VehicleOverlapQuery): Promise<Trip[]> {
    return this.prisma.trip.findMany({
      where: {
        vehicleId: query.vehicleId,
        planningDate: query.planningDate,
        status: { in: [...query.statuses] },
        ...(query.excludeTripId ? { id: { not: query.excludeTripId } } : {}),
        startTime: { not: null, lt: query.endTime },
        endTime: { not: null, gt: query.startTime },
      },
      orderBy: { startTime: "asc" },
    });
  }

  /**
   * Existence check for the owning PDF.
   *
   * Read-only and deliberately narrow: the Import domain has no module yet, and
   * inventing one for a single lookup would be an abstraction built for a later
   * phase. The foreign key remains the real guard.
   */
  async pdfDocumentExists(pdfDocumentId: string): Promise<boolean> {
    const pdfDocument = await this.prisma.pdfDocument.findUnique({
      where: { id: pdfDocumentId },
      select: { id: true },
    });

    return pdfDocument !== null;
  }

  create(data: CreateTripData): Promise<Trip> {
    return this.prisma.trip.create({ data });
  }

  update(id: string, data: UpdateTripData): Promise<Trip> {
    return this.prisma.trip.update({ where: { id }, data });
  }

  /** Used by the status endpoint, by soft delete and by restore. */
  setStatus(id: string, status: TripStatus): Promise<Trip> {
    return this.prisma.trip.update({ where: { id }, data: { status } });
  }

  private buildWhere(filter: FindTripsFilter): Prisma.TripWhereInput {
    return {
      ...this.buildStatusWhere(filter),
      ...this.buildPlanningDateWhere(filter),
      ...(filter.bookingNumber ? { bookingNumber: filter.bookingNumber } : {}),
      ...(filter.containerNumber
        ? { containerNumber: filter.containerNumber }
        : {}),
      ...(filter.driverId ? { driverId: filter.driverId } : {}),
      ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
      ...(filter.terminal ? { terminal: filter.terminal } : {}),
      ...(filter.destinationCity
        ? { destinationCity: filter.destinationCity }
        : {}),
      ...(filter.destinationCountry
        ? { destinationCountry: filter.destinationCountry }
        : {}),
      ...this.buildSearchWhere(filter.search),
    };
  }

  private buildStatusWhere(filter: FindTripsFilter): Prisma.TripWhereInput {
    if (filter.status) {
      return { status: filter.status };
    }

    if (filter.excludeStatuses && filter.excludeStatuses.length > 0) {
      return { status: { notIn: [...filter.excludeStatuses] } };
    }

    return {};
  }

  private buildPlanningDateWhere(
    filter: FindTripsFilter,
  ): Prisma.TripWhereInput {
    if (filter.planningDate) {
      return { planningDate: filter.planningDate };
    }

    if (!filter.planningDateFrom && !filter.planningDateTo) {
      return {};
    }

    return {
      planningDate: {
        ...(filter.planningDateFrom ? { gte: filter.planningDateFrom } : {}),
        ...(filter.planningDateTo ? { lte: filter.planningDateTo } : {}),
      },
    };
  }

  private buildSearchWhere(search?: string): Prisma.TripWhereInput {
    if (!search) {
      return {};
    }

    const contains = { contains: search, mode: Prisma.QueryMode.insensitive };

    return {
      OR: [
        { bookingNumber: contains },
        { containerNumber: contains },
        { terminal: contains },
        { destinationCity: contains },
        { destinationCountry: contains },
      ],
    };
  }
}
