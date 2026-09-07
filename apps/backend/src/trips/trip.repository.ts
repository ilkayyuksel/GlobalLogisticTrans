import { Injectable } from "@nestjs/common";
import { Prisma, Trip, TripGroup, TripStatus } from "@prisma/client";

import { bookingNumberDigits } from "../common/booking-digits";
import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { TripCustomPropertyRepository } from "../trip-custom-properties/trip-custom-property.repository";
import { TripHistoryEvent } from "./trip-history";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The repositories a Trip write may span, bound to a single transaction.
 *
 * Three tables, because writing a Trip is rarely only a Trip: an import also
 * writes the document that explains it, and every write has to leave the Trip's
 * automatic Custom Properties agreeing with its container type. A caller uses
 * the ones it needs and ignores the rest; each is a plain object, so an unused
 * one costs nothing.
 */
export interface TripWriteRepositories {
  readonly trips: TripRepository;
  readonly pdfDocuments: PdfDocumentRepository;
  readonly customProperties: TripCustomPropertyRepository;
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
  /** Exactly these Trips, whatever day they fall on. */
  tripIds?: readonly string[];
  /** Trips carrying this Custom Property. */
  customPropertyId?: string;
  /**
   * BETAALD or NIET BETAALD. Absent means "Alle": no payment filter at all.
   *
   * A tri-state carried as an optional boolean, which is why `undefined` and
   * `false` must never be conflated — `false` is a real question ("show me the
   * unpaid ones") and `undefined` is the absence of one.
   */
  isPaid?: boolean;
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

/**
 * What identifies one Trip: the booking number AND the container number.
 *
 * A booking may carry several containers, and each is its own transport. An
 * ABSENT container number is part of the identity rather than a missing value —
 * a COLLECTION fetches an empty container the document cannot name, so
 * `(ANR123456, null)` identifies exactly one Trip and every later document for
 * that collection finds it.
 */
export interface TripIdentity {
  readonly bookingNumber: string;
  readonly containerNumber: string | null;
  /**
   * The transport date the document stated, and the third part of the identity.
   *
   * ── WHY THE DATE BELONGS HERE ─────────────────────────────────────────────
   * The same booking and the same container legitimately come round again on a
   * later date — the same box, the same reference, a new transport. Without the
   * date those are one identity, so the second order could not be imported at
   * all.
   *
   * ── AND WHY IT IS THE *ORIGINAL* DATE ─────────────────────────────────────
   * `original_planning_date`, never `planning_date`. The current planning date
   * is the operator's to move, and identity that moved with it would mean a
   * later UPDATE or CANCEL for the transport as ORDERED could no longer find
   * the Trip it belongs to.
   *
   * Null on a Trip created by hand with no date at all, and null is a value
   * here rather than a wildcard — exactly as it is for the container number.
   */
  readonly originalPlanningDate: Date | null;
}

export interface TripIdentityQuery {
  identity: TripIdentity;
  /** Only these statuses count as holding the identity. */
  statuses: readonly TripStatus[];
  excludeTripId?: string;
}

export interface BookingNumberQuery {
  bookingNumber: string;
  /** Only these statuses count as holding the booking number. */
  statuses: readonly TripStatus[];
  excludeTripId?: string;
}

/** A booking number narrowed to one transport date. See the method's note. */
export interface BookingNumberOnDateQuery extends BookingNumberQuery {
  readonly originalPlanningDate: Date | null;
}

/**
 * A booking number reduced to its digits — the Cost Confirmation fallback.
 *
 * Deliberately NOT an extension of `BookingNumberQuery`: it carries digits
 * rather than a booking number, and the two must not be passed to each other's
 * lookup by accident.
 */
export interface BookingDigitsQuery {
  readonly digits: string;
  /** Only these statuses count as holding the booking number. */
  readonly statuses: readonly TripStatus[];
  readonly excludeTripId?: string;
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

/** Named here so the repository does not import the whole event vocabulary. */
const UPDATE_APPLIED_EVENT: string = TripHistoryEvent.UpdateApplied;

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
   * Runs `work` against transaction-scoped clones of the repositories a Trip
   * write may span.
   *
   * Importing a transport order writes a PdfDocument, sometimes a TripGroup and
   * one or two Trips, and none of those is meaningful without the others: a
   * document with no Trips explains nothing, and a group with one Trip
   * misrepresents a Combination. One transaction is what makes the import
   * all-or-nothing.
   *
   * The Trip's automatic Custom Properties belong to the same unit for the same
   * reason. A 20FL Trip that committed without its Flat assignment would be
   * under-charged from then on, with nothing on the Trip to reveal it, so the
   * assignment either lands with the Trip or the Trip is not written.
   *
   * The clones are constructed directly rather than injected, the same pattern
   * TripPricingRepository already uses for its snapshot write.
   */
  runTripWriteTransaction<TResult>(
    work: (repositories: TripWriteRepositories) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction((transaction) => {
      const scoped = transaction as unknown as PrismaService;

      return work({
        trips: new TripRepository(scoped),
        pdfDocuments: new PdfDocumentRepository(scoped),
        customProperties: new TripCustomPropertyRepository(scoped),
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

  /**
   * Marks a Trip paid or unpaid, and touches nothing else.
   *
   * Its own method rather than a general `update` call, so the ONE column this
   * operation may write is visible here rather than trusted to every call site.
   * A payment change must never move a Trip's status, and the surest way to
   * guarantee that is an update that cannot express one.
   */
  setPaid(id: string, isPaid: boolean): Promise<Trip> {
    return this.prisma.trip.update({ where: { id }, data: { isPaid } });
  }

  /**
   * Appends events to the audit trail.
   *
   * Append-only: there is no update and no delete here, and there never will
   * be — a record of what happened that can be rewritten is not a record. Many
   * rows at once because ONE document produces one row per field it moved, and
   * they must land together with the change they describe.
   */
  async recordHistory(
    entries: readonly Prisma.TripHistoryUncheckedCreateInput[],
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await this.prisma.tripHistory.createMany({ data: [...entries] });
  }

  /** The document a Trip was created from. Read-only, for its history list. */
  findPdfDocument(pdfDocumentId: string) {
    return this.prisma.pdfDocument.findUnique({
      where: { id: pdfDocumentId },
      // The email is what dates the document; see `findHistoryForTrip`.
      include: { importedEmail: true },
    });
  }

  /**
   * A Trip's history, newest first, with the document each event came from.
   *
   * The document travels on the row, so a caller listing the PDFs of a Trip
   * costs one query rather than one per event.
   */
  findHistoryForTrip(tripId: string) {
    return this.prisma.tripHistory.findMany({
      where: { tripId },
      orderBy: { occurredAt: "desc" },
      /*
       * The email is included because it carries the only authoritative
       * chronology there is: `received_at` is when the mail server accepted the
       * message, which is the order the sender sent them in. Processing time is
       * not — a retry, a restart or a slow poll reorders it.
       */
      include: { pdfDocument: { include: { importedEmail: true } } },
    });
  }

  /**
   * The rows of the most recent APPLIED update of each Trip.
   *
   * One query for a whole page. Every applied-update row of the page is read
   * and the newest occurrence per Trip is picked in memory: an update writes
   * one row per changed field, so "the latest update" is a GROUP of rows
   * sharing a document, not a single row that a `take: 1` could find.
   */
  findAppliedUpdateHistory(tripIds: readonly string[]) {
    if (tripIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.tripHistory.findMany({
      where: { tripId: { in: [...tripIds] }, eventType: UPDATE_APPLIED_EVENT },
      orderBy: { occurredAt: "desc" },
    });
  }

  /**
   * Every Trip planned inside a date range, unpaged.
   *
   * Unpaged because the RANGE is the bound: a caller that asks for one month
   * gets one month of a family fleet's work, not an open-ended table scan. It
   * exists for aggregation — counting Trips per driver — where paging would
   * turn one honest total into a series of partial ones.
   *
   * Both ends are inclusive, matching the range filter the list already uses.
   */
  findByPlanningDateRange(
    from: Date,
    to: Date,
    excludeStatuses: readonly TripStatus[],
  ): Promise<Trip[]> {
    return this.prisma.trip.findMany({
      where: {
        planningDate: { gte: from, lte: to },
        ...(excludeStatuses.length > 0
          ? { status: { notIn: [...excludeStatuses] } }
          : {}),
      },
    });
  }

  /**
   * The Trip currently holding an identity, if any.
   *
   * ── HOW AN ABSENT CONTAINER NUMBER IS MATCHED ─────────────────────────────
   * By `IS NULL`, never by `= NULL`. Prisma compiles `containerNumber: null`
   * to `container_number IS NULL` and a concrete value to `= '...'`, which
   * together is exactly the `IS NOT DISTINCT FROM` semantics this identity
   * needs — a collection's CANCEL and its later UPDATE find the same Trip
   * instead of matching nothing and creating a second one.
   *
   * The database agrees: `trip_identity_key` is declared
   * `NULLS NOT DISTINCT`, so a pair the code treats as taken cannot be
   * inserted twice behind its back either.
   * ──────────────────────────────────────────────────────────────────────────
   */
  findByIdentity(query: TripIdentityQuery): Promise<Trip | null> {
    return this.prisma.trip.findFirst({
      where: {
        bookingNumber: query.identity.bookingNumber,
        containerNumber: query.identity.containerNumber,
        // Exact, including null. Prisma renders `null` as `IS NULL` here, so a
        // Trip with no original date is found only by a query for none.
        originalPlanningDate: query.identity.originalPlanningDate,
        status: { in: [...query.statuses] },
        ...(query.excludeTripId ? { id: { not: query.excludeTripId } } : {}),
      },
    });
  }

  /**
   * Every Trip holding a booking number ON ONE ORIGINAL DATE.
   *
   * The booking-only half of document matching, and it is deliberately NOT
   * `findManyByBookingNumber` with an extra argument. That method belongs to
   * Cost Confirmations, which match on the booking alone and must keep doing
   * so; giving it an optional date would leave one call away from quietly
   * date-scoping money that is not date-scoped.
   *
   * Like the identity lookup, the date is matched exactly — a null original
   * date is found only by a document that states none.
   */
  findManyByBookingNumberAndOriginalDate(
    query: BookingNumberOnDateQuery,
  ): Promise<Trip[]> {
    return this.prisma.trip.findMany({
      where: {
        bookingNumber: query.bookingNumber,
        originalPlanningDate: query.originalPlanningDate,
        status: { in: [...query.statuses] },
        ...(query.excludeTripId ? { id: { not: query.excludeTripId } } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Every Trip holding a booking number, whatever their containers.
   *
   * Not an identity lookup: it deliberately ignores the container number, and
   * exists for the one caller that has only a booking number to go on — a Cost
   * Confirmation, whose documents print a container reference in a different
   * format and sometimes not at all. That caller uses the COUNT to refuse when
   * the booking is ambiguous rather than to pick one.
   */
  findManyByBookingNumber(query: BookingNumberQuery): Promise<Trip[]> {
    return this.prisma.trip.findMany({
      where: {
        bookingNumber: query.bookingNumber,
        status: { in: [...query.statuses] },
        ...(query.excludeTripId ? { id: { not: query.excludeTripId } } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Every Trip whose booking number has the SAME DIGITS as the one given.
   *
   * The Cost Confirmation fallback, and its only caller. A confirmation may
   * print `DUB2793554` or `2793554` for the Trip's `ANRDUB2793554`, so the
   * digits are what the two systems agree on. The comparison is exact equality
   * of those digit strings — never a substring test.
   *
   * ── WHY THE COMPARISON HAPPENS HERE RATHER THAN IN SQL ──────────────────
   * The digits are derived, so a database filter would need
   * `regexp_replace(...)`, which means `$queryRaw` — and raw results skip
   * Prisma's column mapping, handing back `booking_number` instead of
   * `bookingNumber` for every consumer of a Trip. Reading the eligible rows and
   * comparing here keeps one query and correctly typed Trips.
   *
   * The set read is already narrow: DELETED Trips are excluded by the caller's
   * status filter, exactly as they are for every other booking lookup. If this
   * ever needs to scale, the next step is an expression index and a raw query
   * returning ids only — not a second normalisation rule.
   */
  async findManyByBookingDigits(query: BookingDigitsQuery): Promise<Trip[]> {
    const trips = await this.prisma.trip.findMany({
      where: {
        bookingNumber: { not: null },
        status: { in: [...query.statuses] },
        ...(query.excludeTripId ? { id: { not: query.excludeTripId } } : {}),
      },
      orderBy: { createdAt: "asc" },
    });

    return trips.filter(
      (trip) => bookingNumberDigits(trip.bookingNumber) === query.digits,
    );
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
      // An explicit set of Trips, whatever day they fall on. An EMPTY array is
      // deliberately not "no filter": it means no Trip was named, and matching
      // everything would be the opposite of what the caller asked for.
      ...(filter.tripIds ? { id: { in: [...filter.tripIds] } } : {}),
      // A relation filter rather than a join in the service: the database
      // narrows the whole result set, so paging and counts stay correct.
      ...(filter.customPropertyId
        ? {
            customProperties: {
              some: { customPropertyId: filter.customPropertyId },
            },
          }
        : {}),
      /*
       * Explicitly against undefined, NOT truthiness: `isPaid: false` is the
       * "Niet betaald" filter and must reach the database, where a truthiness
       * check would silently drop it and return everything.
       */
      ...(filter.isPaid === undefined ? {} : { isPaid: filter.isPaid }),
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
