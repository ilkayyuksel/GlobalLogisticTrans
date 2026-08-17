import { Injectable } from "@nestjs/common";
import { Prisma, Trip, TripGroup, TripStatus } from "@prisma/client";

import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { PrismaService } from "../prisma/prisma.service";

/** The repositories one import writes through, bound to a single transaction. */
export interface ImportRepositories {
  readonly trips: TripRepository;
  readonly pdfDocuments: PdfDocumentRepository;
}

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
  tripGroupId?: string;
  /** Trips carrying this Custom Property. */
  customPropertyId?: string;
  terminal?: string;
  destinationCity?: string;
  destinationCountry?: string;
  search?: string;
  /** How to order within a day. Absent means the default reading order. */
  sort?: TripSort;
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

/** The time a planner asked to sort a day's work by. */
export type TripSortField = "startTime" | "endTime";
export type SortDirection = "asc" | "desc";

export interface TripSort {
  field: TripSortField;
  direction: SortDirection;
}

/**
 * The order a planning list is read in.
 *
 * ── FOUR KEYS, AND WHY EACH IS WHERE IT IS ──────────────────────────────────
 * 1. planningDate  A day is the unit of planning. It stays the first key
 *                  whatever the operator sorts by, because the Day/Week/Month
 *                  views are built from date sections — sorting globally by
 *                  time would scatter one day's work across the whole period.
 *
 * 2. the vehicle   So one truck's Trips read as a block. Ordered by PLATE
 *                  rather than by id: a UUID groups just as well but presents
 *                  the trucks in an order nobody recognises. Trips with no
 *                  vehicle sort last — Postgres puts NULLs last in ASC, which
 *                  is exactly the wanted "unassigned at the bottom".
 *
 * 3. the chosen    Start or end time, ascending or descending as asked. Nulls
 *    time          are pinned LAST in both directions: a Trip with no time is
 *                  not early, it is unknown, and floating it to the top of a
 *                  descending list would read as "latest".
 *
 * 4. id            A total order. Without it two Trips that tie on every key
 *                  above could swap places between two requests, which makes
 *                  paging drop or repeat rows.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The date keeps the descending order the list has always had — newest day
 * first — so which Trips fall on which page does not change under anyone's
 * feet. `sortDirection` applies to the TIME within a day, which is what the
 * operator is actually choosing; the Day/Week/Month sections are ordered by the
 * frontend from the date range it asked for.
 */
export function buildOrderBy(
  sort: TripSort | undefined,
): Prisma.TripOrderByWithRelationInput[] {
  const direction: SortDirection = sort?.direction ?? "asc";
  const timeKey: TripSortField = sort?.field ?? "startTime";

  return [
    { planningDate: "desc" },
    { vehicle: { licensePlate: "asc" } },
    { [timeKey]: { sort: direction, nulls: "last" } },
    { id: "asc" },
  ];
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
   * Runs `work` against transaction-scoped clones of this repository and the
   * PdfDocument repository.
   *
   * Importing a transport order writes a PdfDocument, sometimes a TripGroup and
   * one or two Trips, and none of those is meaningful without the others: a
   * document with no Trips explains nothing, and a group with one Trip
   * misrepresents a Combination. One transaction is what makes the import
   * all-or-nothing.
   *
   * Both clones are constructed directly rather than injected, the same pattern
   * TripPricingRepository already uses for its snapshot write.
   */
  runImportTransaction<TResult>(
    work: (repositories: ImportRepositories) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction((transaction) => {
      const scoped = transaction as unknown as PrismaService;

      return work({
        trips: new TripRepository(scoped),
        pdfDocuments: new PdfDocumentRepository(scoped),
      });
    });
  }

  /**
   * Creates the group that ties a Combination's two Trips together.
   *
   * `trip_group` carries no columns of its own beyond its identity — the
   * relationship IS the data — so there is nothing to pass in.
   */
  createTripGroup(): Promise<TripGroup> {
    return this.prisma.tripGroup.create({ data: {} });
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
        orderBy: buildOrderBy(filter.sort),
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

  /**
   * The distinct terminals Trips actually carry, alphabetically.
   *
   * Read from the Trips themselves rather than from master data, because there
   * is none: the terminal is the string the PDF printed, and this endpoint
   * exists only so a filter can offer the values that are really there.
   * DELETED Trips are excluded — a filter must not offer a value that returns
   * nothing in the normal list.
   */
  async findDistinctTerminals(
    excludeStatuses: readonly TripStatus[],
  ): Promise<string[]> {
    const rows = await this.prisma.trip.findMany({
      where: {
        terminal: { not: null },
        status: { notIn: [...excludeStatuses] },
      },
      distinct: ["terminal"],
      select: { terminal: true },
      orderBy: { terminal: "asc" },
    });

    return rows
      .map((row) => row.terminal)
      .filter((terminal): terminal is string => terminal !== null);
  }

  /**
   * The Custom Properties of a page of Trips, in one query.
   *
   * Keyed by Trip id so the caller can attach them without looping over the
   * database. The join row carries the property, so nothing is fetched twice.
   */
  findCustomPropertiesForTrips(tripIds: readonly string[]) {
    return this.prisma.tripCustomProperty.findMany({
      where: { tripId: { in: [...tripIds] } },
      include: { customProperty: true },
      orderBy: { customProperty: { displayOrder: "asc" } },
    });
  }

  /**
   * The Trips a manual grouping request names.
   *
   * Returned unordered and possibly shorter than the list asked for; deciding
   * what a missing one means is the service's job, not this one's.
   */
  findManyByIds(ids: readonly string[]): Promise<Trip[]> {
    return this.prisma.trip.findMany({ where: { id: { in: [...ids] } } });
  }

  /** Puts every named Trip in one group, in a single statement. */
  async assignToGroup(
    ids: readonly string[],
    tripGroupId: string,
  ): Promise<number> {
    const { count } = await this.prisma.trip.updateMany({
      where: { id: { in: [...ids] } },
      data: { tripGroupId },
    });

    return count;
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
      ...(filter.tripGroupId ? { tripGroupId: filter.tripGroupId } : {}),
      // A relation filter rather than a join in the service: the database
      // narrows the whole result set, so paging and counts stay correct.
      ...(filter.customPropertyId
        ? {
            customProperties: {
              some: { customPropertyId: filter.customPropertyId },
            },
          }
        : {}),
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
