import { Injectable } from "@nestjs/common";
import { Prisma, Trip, TripStatus } from "@prisma/client";

import { changedFieldNames } from "../common/changed-fields";
import { toUtcDate } from "../common/dates";
import { DomainEventBus } from "../common/events/domain-event-bus";
import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { toUtcTime } from "../common/time-of-day";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { ChangeTripStatusDto } from "./dto/change-trip-status.dto";
import { CreateTripDto } from "./dto/create-trip.dto";
import { ListTripsQueryDto } from "./dto/list-trips-query.dto";
import {
  PaginatedTripsDto,
  TripResponseDto,
  toTripResponse,
} from "./dto/trip-response.dto";
import { UpdateTripDto } from "./dto/update-trip.dto";
import { TripClosedEvent } from "./events/trip-closed.event";
import { ImportTripsCommand } from "./import-trips.command";
import {
  AssignmentSubject,
  DuplicateBookingNumberException,
  InactiveAssignmentException,
  InvalidTripStatusTransitionException,
  TooFewTripsToGroupException,
  TripAlreadyGroupedException,
  TripNotDeletableException,
  TripNotDeletedException,
  TripNotFoundException,
  TripNotInGroupException,
  UnknownPdfDocumentException,
} from "./exceptions/trip.exceptions";
import {
  BOOKING_NUMBER_HOLDING_STATUSES,
  DELETABLE_FROM_STATUS,
  RESTORED_STATUS,
  allowedTransitionsFrom,
  canTransition,
} from "./trip-status.rules";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";

/**
 * A group is a relationship, and one Trip is not a relationship.
 *
 * Only a lower bound: a manual group has no upper one, because an operator
 * deciding that five Trips belong together is not a mistake the system needs to
 * prevent.
 */
const MINIMUM_TRIPS_PER_GROUP = 2;

/** DELETED Trips must not appear in normal planning views. */
const HIDDEN_BY_DEFAULT_STATUSES: readonly TripStatus[] = [TripStatus.DELETED];

/**
 * Manual Trip management.
 *
 * This service owns the Trip lifecycle and the manual planning fields. It does
 * not price, parse, import or export: those belong to the Pricing Engine, the
 * Parser Service, the IMAP Service and the export module respectively.
 *
 * Business values — booking numbers, container numbers, destinations, notes,
 * distances and waiting times — are never written to the log. Only identifiers
 * and field names are, so a log line stays useful without carrying commercial
 * or personal data.
 */
/**
 * More than any real group holds, so the read is bounded without ever
 * truncating one. A Combination has two; a manual group, a few.
 */
const GROUP_MEMBER_LIMIT = 100;

@Injectable()
export class TripService {
  constructor(
    private readonly repository: TripRepository,
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly planningData: TripPlanningDataService,
    private readonly eventBus: DomainEventBus,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripService.name);
  }

  /**
   * One Trip as a response, with its Vehicle and effective Driver resolved.
   *
   * Every path that returns a Trip goes through here or through `toResponses`,
   * so `effectiveDriver` always means "resolved and this is the answer" — never
   * "nobody looked". A client cannot tell those apart, so they must not both be
   * possible.
   */
  private async toResponse(trip: Trip): Promise<TripResponseDto> {
    return toTripResponse(trip, await this.planningData.resolveOne(trip));
  }

  /**
   * A page of Trips, resolved together.
   *
   * The batch is the point: resolving a page costs a fixed handful of queries
   * rather than one per Trip.
   */
  private async toResponses(trips: readonly Trip[]): Promise<TripResponseDto[]> {
    const planning = await this.planningData.resolveMany(trips);

    return trips.map((trip) =>
      toTripResponse(
        trip,
        planning.get(trip.id) ?? {
          vehicle: null,
          effectiveDriver: null,
          customProperties: [],
        },
      ),
    );
  }

  async findAll(query: ListTripsQueryDto): Promise<PaginatedTripsDto> {
    const { items, totalItems } = await this.repository.findPage({
      status: query.status,
      excludeStatuses: HIDDEN_BY_DEFAULT_STATUSES,
      planningDate: query.planningDate
        ? toUtcDate(query.planningDate)
        : undefined,
      planningDateFrom: query.planningDateFrom
        ? toUtcDate(query.planningDateFrom)
        : undefined,
      planningDateTo: query.planningDateTo
        ? toUtcDate(query.planningDateTo)
        : undefined,
      bookingNumber: query.bookingNumber,
      containerNumber: query.containerNumber,
      driverId: query.driverId,
      vehicleId: query.vehicleId,
      tripGroupId: query.tripGroupId,
      customPropertyId: query.customPropertyId,
      // Absent means the default reading order; the repository owns what that
      // is, so an unsorted request and a sorted one take the same path.
      sort: query.sortBy
        ? {
            field: query.sortBy,
            direction: query.sortDirection ?? "asc",
          }
        : undefined,
      terminal: query.terminal,
      destinationCity: query.destinationCity,
      destinationCountry: query.destinationCountry,
      search: query.search,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: await this.toResponses(items),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  async findById(id: string): Promise<TripResponseDto> {
    return this.toResponse(await this.requireTrip(id));
  }

  /**
   * Every Trip in one group.
   *
   * Internal and deliberately narrow: there is no route and no DTO, because
   * this answers one question the Pricing Engine has to ask — which Trips share
   * this Trip's group, so it can tell a real Combination from a manual group.
   *
   * Unpaginated on purpose. A group holds two Trips in the case that matters
   * and a handful at most in any other; paging it would be machinery for a size
   * that does not occur.
   */
  async findByGroupId(
    tripGroupId: string,
  ): Promise<{ items: TripResponseDto[] }> {
    const { items } = await this.repository.findPage({
      tripGroupId,
      skip: 0,
      take: GROUP_MEMBER_LIMIT,
    });

    return { items: await this.toResponses(items) };
  }

  /**
   * The terminals a filter may offer.
   *
   * The values Trips actually carry, not master data — there is none, and the
   * terminal is the string the transport order printed.
   */
  findTerminals(): Promise<string[]> {
    return this.repository.findDistinctTerminals(HIDDEN_BY_DEFAULT_STATUSES);
  }

  /**
   * Creates a Trip by hand.
   *
   * ── A MANUAL TRIP MAY BE ALMOST EMPTY ───────────────────────────────────────
   * A Trip used to be, by construction, the product of a parsed transport
   * order. One entered by hand is not: a phone call announces a job and the
   * booking number, container, destination and date follow later. So the PDF,
   * the booking number, the container type, the destination and both dates may
   * all be absent, and absence is stored as null — never as an invented
   * placeholder, which would be a value the business would then have to
   * recognise and strip everywhere.
   *
   * What has NOT been relaxed is the checking of values that ARE given: a
   * supplied PDF must exist, a supplied Vehicle must be active, and a supplied
   * booking number must be free. Optional means "may be absent", not
   * "unvalidated".
   * ────────────────────────────────────────────────────────────────────────────
   *
   * Everything that can be checked without writing is checked first, so a
   * rejected request never leaves a partially valid row behind. The booking
   * check then runs inside the transaction that performs the insert, keeping
   * the window in which a concurrent write could slip between them as small as
   * the database allows.
   */
  async create(dto: CreateTripDto): Promise<TripResponseDto> {
    const pdfDocumentId = dto.pdfDocumentId ?? null;
    const bookingNumber = dto.bookingNumber ?? null;

    if (pdfDocumentId !== null) {
      await this.assertPdfDocumentExists(pdfDocumentId);
    }

    await this.assertAssignable("vehicle", dto.vehicleId);
    await this.assertAssignable("driver", dto.driverId);

    const planningDate = toNullableDate(dto.planningDate);
    const startTime = toNullableTime(dto.startTime);
    const endTime = toNullableTime(dto.endTime);

    /*
     * The original planning date records what was planned BEFORE anyone moved
     * the Trip. For a Trip created now, that is the date it is being created
     * with — so it defaults to the planning date rather than being asked for
     * twice, and stays null when there is no date at all.
     */
    const originalPlanningDate =
      dto.originalPlanningDate === undefined || dto.originalPlanningDate === null
        ? planningDate
        : toUtcDate(dto.originalPlanningDate);

    const created = await this.repository.runInTransaction(
      async (repository) => {
        if (bookingNumber !== null) {
          await this.assertBookingNumberFree(repository, bookingNumber);
        }

        return repository.create({
          pdfDocumentId,
          bookingNumber,
          containerNumber: dto.containerNumber ?? null,
          containerType: dto.containerType ?? null,
          terminal: dto.terminal ?? null,
          destinationCity: dto.destinationCity ?? null,
          destinationCountry: dto.destinationCountry ?? null,
          originalPlanningDate,
          planningDate,
          startTime,
          endTime,
          executionDatetime: toNullableDateTime(dto.executionDatetime),
          vehicleId: dto.vehicleId ?? null,
          driverId: dto.driverId ?? null,
          waitingTimeMinutes: dto.waitingTimeMinutes ?? null,
          distanceKm: dto.distanceKm ?? null,
          internalNotes: dto.internalNotes ?? null,
        });
      },
    );

    this.logger.log("Trip created", {
      tripId: created.id,
      status: created.status,
      pdfDocumentId: created.pdfDocumentId,
    });

    return this.toResponse(created);
  }

  /**
   * Updates the manual planning fields.
   *
   * Assignment eligibility is re-checked only when the Vehicle or Driver
   * actually changes: the rule applies to new assignments, and a Trip that
   * already carries a since-deactivated Vehicle must stay editable.
   */
  async update(id: string, dto: UpdateTripDto): Promise<TripResponseDto> {
    const existing = await this.requireTrip(id);

    if (dto.vehicleId !== undefined && dto.vehicleId !== existing.vehicleId) {
      await this.assertAssignable("vehicle", dto.vehicleId);
    }

    if (dto.driverId !== undefined && dto.driverId !== existing.driverId) {
      await this.assertAssignable("driver", dto.driverId);
    }

    const updated = await this.repository.update(id, this.toUpdateData(dto));

    this.logger.log("Trip updated", {
      tripId: id,
      changedFields: changedFieldNames(dto),
    });

    return this.toResponse(updated);
  }

  /**
   * Moves a Trip through the business lifecycle.
   *
   * Reopening a cancelled Trip can resurrect a clash: another Trip may have
   * taken the booking number or the Vehicle slot while this one was cancelled,
   * so both are re-checked rather than assumed still free.
   */
  async changeStatus(
    id: string,
    dto: ChangeTripStatusDto,
  ): Promise<TripResponseDto> {
    const trip = await this.requireTrip(id);

    if (trip.status === dto.status) {
      return this.toResponse(trip);
    }

    this.assertTransitionAllowed(trip.status, dto.status);

    const changed = await this.repository.runInTransaction(
      async (repository) => {
        if (dto.status === TripStatus.OPEN) {
          await this.assertReclaimable(repository, trip);
        }

        return repository.setStatus(id, dto.status);
      },
    );

    this.logger.log("Trip status changed", {
      tripId: id,
      fromStatus: trip.status,
      toStatus: changed.status,
    });

    await this.announceIfClosed(changed);

    return this.toResponse(changed);
  }

  /**
   * Publishes the fact that a Trip has closed, once it truly has.
   *
   * Deliberately AFTER the transaction has committed and after the status log.
   * A subscriber reads the Trip for itself, and inside the transaction it would
   * still see the previous status — so it would price a Trip the database does
   * not yet consider closed, or price nothing at all if the commit then failed.
   *
   * Equally deliberately, the pricing calculation is NOT part of the status
   * transaction. Pricing reads Settings, route configuration and properties and
   * writes a snapshot of its own; holding the Trip row for all of that would
   * turn a short status update into a long lock.
   *
   * The status is checked rather than the transition, because CLOSED is
   * reachable only from OPEN and only through this method — trip-status.rules
   * is the single source of that truth, and restating "from OPEN" here would
   * duplicate the matrix.
   *
   * TripService knows nothing about what happens next. It announces a fact; the
   * Pricing Engine subscribes on its own side, which is what keeps the Trip
   * module free of any dependency on pricing.
   */
  private async announceIfClosed(trip: Trip): Promise<void> {
    if (trip.status !== TripStatus.CLOSED) {
      return;
    }

    await this.eventBus.publish(new TripClosedEvent(trip.id));
  }

  /**
   * Creates the Trips of one imported transport order, atomically.
   *
   * Internal: there is no DTO and no route. An import is not a request a user
   * composes — it is the consequence of a document — and exposing it would mean
   * exposing `tripGroupId` and `parserMetadata`, which are the two fields the
   * public contract deliberately withholds because only the parser may set
   * them.
   *
   * ONE transaction covers the PdfDocument, the optional TripGroup and every
   * Trip. A Combination that created one Trip and then failed would leave a
   * group misrepresenting a two-leg order as a one-leg one, so nothing is
   * written unless all of it can be.
   *
   * Every existing rule still applies: the booking number must be free, and it
   * is checked inside the transaction, so re-importing the same document fails
   * rather than silently duplicating a Trip.
   *
   * Trips are created OPEN, like every other Trip. Pricing is not this
   * operation's concern and is never triggered here.
   */
  async importTrips(command: ImportTripsCommand): Promise<TripResponseDto[]> {
    const created = await this.repository.runImportTransaction(
      async ({ trips, pdfDocuments }) => {
        const pdfDocument = await pdfDocuments.create(command.pdfDocument);

        const tripGroup = command.asCombination
          ? await trips.createTripGroup()
          : null;

        const written: Trip[] = [];

        for (const trip of command.trips) {
          await this.assertBookingNumberFree(trips, trip.bookingNumber);

          written.push(
            await trips.create({
              pdfDocumentId: pdfDocument.id,
              tripGroupId: tripGroup ? tripGroup.id : null,
              bookingNumber: trip.bookingNumber,
              containerNumber: trip.containerNumber,
              containerType: trip.containerType,
              terminal: trip.terminal,
              destinationCity: trip.destinationCity,
              destinationCountry: trip.destinationCountry,
              originalPlanningDate: toUtcDate(trip.planningDate),
              planningDate: toUtcDate(trip.planningDate),
              startTime: trip.startTime ? toUtcTime(trip.startTime) : null,
              endTime: trip.endTime ? toUtcTime(trip.endTime) : null,
              direction: trip.direction,
              parserMetadata: trip.parserMetadata,
            }),
          );
        }

        return written;
      },
    );

    this.logger.log("Transport order imported", {
      tripIds: created.map((trip) => trip.id),
      tripGroupId: created[0]?.tripGroupId ?? null,
      pdfDocumentId: created[0]?.pdfDocumentId ?? null,
      tripCount: created.length,
    });

    return this.toResponses(created);
  }

  /**
   * Puts several Trips into one group, by hand.
   *
   * ── A MANUAL GROUP IS NOT A COMBINATION ─────────────────────────────────────
   * A Combination comes from one PDF and means something specific: two legs of
   * one transport, one collection and one delivery. THIS does not. It is an
   * operator saying "these belong together", and the system holds no opinion
   * about how many Trips that is beyond two, which directions they carry, which
   * days they fall on or which statuses they hold.
   *
   * Both kinds are the same row, because the schema has one: `trip_group` has
   * no columns beyond its identity, and adding a type would be inventing a
   * distinction nothing yet reads.
   * ────────────────────────────────────────────────────────────────────────────
   *
   * The whole operation is one transaction: the group and every assignment
   * commit together, so a rejected Trip leaves no empty group behind.
   */
  async createGroup(tripIds: readonly string[]): Promise<TripResponseDto[]> {
    if (tripIds.length < MINIMUM_TRIPS_PER_GROUP) {
      throw new TooFewTripsToGroupException(MINIMUM_TRIPS_PER_GROUP);
    }

    const grouped = await this.repository.runInTransaction(
      async (repository) => {
        const trips = await repository.findManyByIds(tripIds);

        this.assertAllTripsExist(tripIds, trips);
        this.assertNoneAlreadyGrouped(trips);

        const group = await repository.createTripGroup();

        await repository.assignToGroup(tripIds, group.id);

        // Re-read inside the transaction: the rows now carry the group, and the
        // response must show what was actually written rather than what was
        // asked for.
        return repository.findManyByIds(tripIds);
      },
    );

    this.logger.log("Trips grouped", {
      tripGroupId: grouped[0]?.tripGroupId ?? null,
      tripIds: grouped.map((trip) => trip.id),
      tripCount: grouped.length,
    });

    return this.toResponses(grouped);
  }

  /**
   * Takes one Trip out of its group, leaving the group and the others alone.
   *
   * A group may be left with a single member, and that is deliberate: deleting
   * it automatically would be a second, hidden decision about data the operator
   * can still see and act on. An empty group is simply unreferenced.
   */
  async removeFromGroup(id: string): Promise<TripResponseDto> {
    const trip = await this.requireTrip(id);

    if (!trip.tripGroupId) {
      throw new TripNotInGroupException(id);
    }

    const updated = await this.repository.update(id, { tripGroupId: null });

    this.logger.log("Trip removed from its group", {
      tripId: id,
      previousTripGroupId: trip.tripGroupId,
    });

    return this.toResponse(updated);
  }

  private assertAllTripsExist(
    requestedIds: readonly string[],
    found: readonly Trip[],
  ): void {
    const foundIds = new Set(found.map((trip) => trip.id));
    const missing = requestedIds.find((id) => !foundIds.has(id));

    if (missing) {
      throw new TripNotFoundException(missing);
    }
  }

  /**
   * Grouping never moves a Trip out of an existing group.
   *
   * Doing so silently would change the meaning of the group it left — a
   * Combination missing a leg is no longer a Combination. Unlinking is a
   * separate, deliberate action.
   */
  private assertNoneAlreadyGrouped(trips: readonly Trip[]): void {
    const grouped = trips.find((trip) => trip.tripGroupId !== null);

    if (grouped) {
      throw new TripAlreadyGroupedException(
        grouped.id,
        grouped.tripGroupId as string,
      );
    }
  }

  /**
   * Soft delete. The row is never removed, so history, exports and pricing keep
   * resolving it.
   *
   * Only an OPEN Trip may be deleted. Restore has to return the Trip to the
   * status it held before, and that previous status lives in trip_history,
   * which does not exist yet — restricting the entry point keeps restore exact
   * instead of guessing.
   */
  async softDelete(id: string): Promise<TripResponseDto> {
    const trip = await this.requireTrip(id);

    if (trip.status === TripStatus.DELETED) {
      return this.toResponse(trip);
    }

    if (trip.status !== DELETABLE_FROM_STATUS) {
      throw new TripNotDeletableException(
        id,
        trip.status,
        DELETABLE_FROM_STATUS,
      );
    }

    const deleted = await this.repository.setStatus(id, TripStatus.DELETED);

    this.logger.log("Trip deleted", { tripId: id, fromStatus: trip.status });

    return this.toResponse(deleted);
  }

  /**
   * Brings a deleted Trip back to OPEN.
   *
   * A deleted Trip releases its booking number and its Vehicle slot, so both
   * may have been taken in the meantime and are re-checked before the Trip
   * reclaims them.
   */
  async restore(id: string): Promise<TripResponseDto> {
    const trip = await this.requireTrip(id);

    if (trip.status !== TripStatus.DELETED) {
      throw new TripNotDeletedException(id, trip.status);
    }

    const restored = await this.repository.runInTransaction(
      async (repository) => {
        await this.assertReclaimable(repository, trip);

        return repository.setStatus(id, RESTORED_STATUS);
      },
    );

    this.logger.log("Trip restored", {
      tripId: id,
      toStatus: restored.status,
    });

    return this.toResponse(restored);
  }

  private async requireTrip(id: string): Promise<Trip> {
    const trip = await this.repository.findById(id);

    if (!trip) {
      throw new TripNotFoundException(id);
    }

    return trip;
  }

  private async assertPdfDocumentExists(pdfDocumentId: string): Promise<void> {
    if (!(await this.repository.pdfDocumentExists(pdfDocumentId))) {
      throw new UnknownPdfDocumentException(pdfDocumentId);
    }
  }

  /**
   * A Trip may only be assigned to an active Vehicle or Driver.
   *
   * Existence is delegated to the owning service, which reuses its lookup and
   * its 404 instead of duplicating either here. Null means "unassign", which is
   * always allowed.
   */
  private async assertAssignable(
    subject: AssignmentSubject,
    subjectId: string | null | undefined,
  ): Promise<void> {
    if (!subjectId) {
      return;
    }

    const assignee =
      subject === "vehicle"
        ? await this.vehicleService.findById(subjectId)
        : await this.driverService.findById(subjectId);

    if (!assignee.isActive) {
      this.logger.warn("Rejected assignment of an inactive subject", {
        subject,
        subjectId,
      });

      throw new InactiveAssignmentException(subject, subjectId);
    }
  }

  /**
   * A booking number identifies one Trip, and each Trip carries its own.
   *
   * This includes the two Trips of a Combination: the real documents give the
   * outbound and return legs DIFFERENT booking numbers, and they are linked to
   * each other through their shared TripGroup, never through their booking
   * number. So uniqueness applies to every Trip independently, with no
   * exception carved out for a Combination.
   *
   * The database index is deliberately non-unique all the same, because a
   * DELETED Trip does not hold its booking number: soft delete is the
   * documented remedy for a Trip created in error, and it would be no remedy if
   * the booking could never be re-entered. A database constraint cannot express
   * "unique among the statuses that hold it", so the rule is enforced here.
   */
  private async assertBookingNumberFree(
    repository: TripRepository,
    bookingNumber: string,
    excludeTripId?: string,
  ): Promise<void> {
    const holder = await repository.findByBookingNumber({
      bookingNumber,
      statuses: BOOKING_NUMBER_HOLDING_STATUSES,
      excludeTripId,
    });

    if (holder) {
      this.logger.warn("Rejected duplicate booking number", {
        tripId: excludeTripId,
        conflictingTripId: holder.id,
      });

      throw new DuplicateBookingNumberException(bookingNumber, holder.id);
    }
  }

  /*
   * ── THERE IS DELIBERATELY NO VEHICLE-OVERLAP RULE ─────────────────────────
   * A Vehicle used to be refused when another Trip already occupied its
   * planned interval. That rule is gone, by an explicit decision of the
   * business: real planning legitimately overlaps — a truck is re-planned
   * mid-shift, two legs are entered before their times are settled, an
   * administrator is correcting history — and a refusal at the moment of
   * saving forced the planner to fight the system rather than plan with it.
   *
   * Deciding whether an overlap is intentional is the planner's job, not this
   * service's. Nothing else about assignment was relaxed: the Vehicle must
   * exist and be active, and every other Trip rule still applies.
   * ──────────────────────────────────────────────────────────────────────────
   */

  /**
   * Re-acquires the booking number a Trip gave up.
   *
   * Only the booking number: a Vehicle is no longer exclusive to one interval,
   * so a restored Trip cannot be refused on the grounds that its truck has
   * since been planned elsewhere.
   */
  private async assertReclaimable(
    repository: TripRepository,
    trip: Trip,
  ): Promise<void> {
    // A Trip with no booking number has none to re-acquire. Uniqueness applies
    // to the booking numbers that exist, and absence is not a value that can
    // collide.
    if (trip.bookingNumber === null) {
      return;
    }

    await this.assertBookingNumberFree(repository, trip.bookingNumber, trip.id);
  }

  private assertTransitionAllowed(from: TripStatus, to: TripStatus): void {
    if (!canTransition(from, to)) {
      this.logger.warn("Rejected invalid Trip status transition", {
        fromStatus: from,
        toStatus: to,
      });

      throw new InvalidTripStatusTransitionException(
        from,
        to,
        allowedTransitionsFrom(from),
      );
    }
  }

  /**
   * Maps the DTO onto Prisma's update input.
   *
   * Fields the caller omitted stay `undefined`, which Prisma reads as "leave
   * alone", while an explicit null clears the column — exactly PATCH semantics.
   */
  private toUpdateData(dto: UpdateTripDto): Prisma.TripUncheckedUpdateInput {
    return {
      containerNumber: dto.containerNumber,
      planningDate:
        dto.planningDate === undefined
          ? undefined
          : toUtcDate(dto.planningDate),
      vehicleId: dto.vehicleId,
      driverId: dto.driverId,
      waitingTimeMinutes: dto.waitingTimeMinutes,
      distanceKm: dto.distanceKm,
      executionDatetime:
        dto.executionDatetime === undefined
          ? undefined
          : toNullableDateTime(dto.executionDatetime),
      internalNotes: dto.internalNotes,
    };
  }
}

function toNullableDate(value: string | null | undefined): Date | null {
  return value ? toUtcDate(value) : null;
}

function toNullableTime(value: string | null | undefined): Date | null {
  return value ? toUtcTime(value) : null;
}

function toNullableDateTime(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}
