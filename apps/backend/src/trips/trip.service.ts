import { Injectable } from "@nestjs/common";
import { Prisma, Trip, TripStatus } from "@prisma/client";

import { changedFieldNames } from "../common/changed-fields";
import { toUtcDate } from "../common/dates";
import { DomainEventBus } from "../common/events/domain-event-bus";
import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { toUtcTime } from "../common/time-of-day";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { PricingRecalculationService } from "../pricing-engine/pricing-recalculation.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { ChangeTripPaymentDto } from "./dto/change-trip-payment.dto";
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
import { toContainerIdentity } from "./document-trip-matching";
import { changesWaitingTimeWindow, toWaitingTimeWrite } from "./waiting-window";
import { ImportTripsCommand } from "./import-trips.command";
import {
  AssignmentSubject,
  DeletedTripCannotBeLooseException,
  DocumentControlledFieldException,
  IncompleteWaitingWindowException,
  DuplicateBookingNumberException,
  GroupedTripCannotBeLooseException,
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
  DELETABLE_FROM_STATUSES,
  RESTORED_STATUS,
  allowedTransitionsFrom,
  canTransition,
} from "./trip-status.rules";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripIdentity, TripRepository } from "./trip.repository";

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
    private readonly automaticFlat: AutomaticFlatPropertyService,
    private readonly recalculation: PricingRecalculationService,
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
          latestUpdate: null,
          costConfirmation: null,
          pricing: null,
        },
      ),
    );
  }

  async findAll(query: ListTripsQueryDto): Promise<PaginatedTripsDto> {
    const { items, totalItems } = await this.repository.findPage({
      status: query.status,
      excludeStatuses: HIDDEN_BY_DEFAULT_STATUSES,
      /*
       * Passed straight through, `undefined` included: absent means "Alle" and
       * must stay absent all the way to the query. The database narrows the
       * result set, so paging and the counts stay correct — filtering a page
       * after it was fetched would page over the wrong set.
       */
      isPaid: query.isPaid,
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
      tripIds: query.tripIds,
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

    const created = await this.repository.runTripWriteTransaction(
      async ({ trips: repository, customProperties }) => {
        if (bookingNumber !== null) {
          await this.assertIdentityFree(repository, {
            bookingNumber,
            // Canonical before it is stored: an operator types `EUCU 145129/5`
          // off a document and the Trip holds `EUCU1451295`, which is what
          // every later document is matched against.
          containerNumber: toContainerIdentity(dto.containerNumber),
          });
        }

        const trip = await repository.create({
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
          /*
           * The two times win when they are given: the duration is derived
           * from them so the three columns cannot disagree. A Trip created
           * with only a duration keeps it, and keeps no times — which is
           * exactly what an entry made before the window existed looks like.
           */
          ...toWaitingTimeOnCreate(dto),
          distanceKm: dto.distanceKm ?? null,
          internalNotes: dto.internalNotes ?? null,
          // The operator's own classification. Absent means an ordinary Trip;
          // nothing infers it from a missing PDF or an empty booking number.
          isLooseTrip: dto.isLooseTrip ?? false,
        });

        /*
         * The container type decides this, not the person filling the form —
         * a Trip entered by hand as 20FL owes the same charge as one that
         * arrived on a document. Inside the transaction, so the Trip cannot
         * exist without the property its type requires.
         */
        await this.automaticFlat.applyToNewTrip(
          customProperties,
          trip.id,
          trip.containerType,
        );

        return trip;
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
   *
   * The destination and the transport times are checked separately, because
   * whether they are manual depends on the TRIP rather than on the field — see
   * `assertDocumentFieldsEditable`.
   */
  async update(id: string, dto: UpdateTripDto): Promise<TripResponseDto> {
    const existing = await this.requireTrip(id);

    this.assertWaitingWindowIsComplete(dto);
    this.assertDocumentFieldsEditable(existing, dto);

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

    return this.respondToUpdate(updated, dto);
  }

  /**
   * The updated Trip, priced again when the update touched a pricing input.
   *
   * ── WHY WAITING TIME AND NOT EVERY FIELD ────────────────────────────────
   * The waiting-time window is the one input on this endpoint that an operator
   * edits AFTER the work is finished and that the Pricing Engine bills from.
   * Changing it must leave the Trip's stored pricing current, and the operator
   * must see the new Others and Totaal in the answer to their own request
   * rather than in a later refresh.
   *
   * Every other field here is either not a pricing input at all — a container
   * number, a vehicle, a note — or belongs to a Trip that is still being
   * planned, where the price is produced when it closes.
   *
   * The window is treated as changed when it was SENT, which is the same test
   * `toWaitingTimeWrite` uses to decide whether this update is about waiting
   * time at all. Recalculating a window that was re-sent unchanged costs one
   * calculation and produces the same snapshot; missing a real change would
   * leave the money describing the previous window.
   *
   * ── AND WHY THE STATUS IS NEVER TOUCHED ─────────────────────────────────
   * A CLOSED Trip stays CLOSED. The price of a finished job may change; the
   * fact that it is finished may not, and there is no CLOSED -> OPEN anywhere
   * in this system.
   */
  private async respondToUpdate(
    updated: Trip,
    dto: UpdateTripDto,
  ): Promise<TripResponseDto> {
    const response = await this.toResponse(updated);

    if (!changesWaitingTimeWindow(dto)) {
      return response;
    }

    const outcome = await this.recalculation.recalculate(updated.id);

    /*
     * The recalculated answer REPLACES what the response already carried. On
     * failure that means null rather than the figures the read produced: those
     * describe the window before this edit, and presenting them as current
     * would be a stale amount nothing on the screen could reveal. The write
     * itself is kept either way.
     */
    return {
      ...response,
      pricing: outcome.pricing,
      reasonCode: outcome.reasonCode,
    };
  }

  /**
   * Moves a Trip through the business lifecycle.
   *
   * Reopening a cancelled Trip can resurrect a clash: another Trip may have
   * taken the booking number or the Vehicle slot while this one was cancelled,
   * so both are re-checked rather than assumed still free.
   */
  /**
   * The Trip holding a booking number, or null.
   *
   * Exact match among the statuses that hold a booking number — the same rule
   * a revision and a cancellation use. Null is an ordinary answer: a document
   * may name a booking this system has never seen, and inventing the Trip it
   * refers to is exactly what must not happen.
   */
  /**
   * Every Trip holding a booking number, whatever their containers.
   *
   * NOT an identity lookup, and the only caller is the one that cannot do
   * better: a Cost Confirmation prints its container reference in a different
   * format from a transport order, and sometimes not at all, so it has the
   * booking number and nothing else to go on.
   *
   * It returns the LIST rather than the first match on purpose. One booking can
   * now carry several Trips, and a confirmation that picked one of them would
   * put money on a transport nobody checked. The caller refuses instead — see
   * `CostConfirmationAmbiguousException`.
   */
  async findAllByBookingNumber(bookingNumber: string): Promise<Trip[]> {
    return this.repository.findManyByBookingNumber({
      bookingNumber,
      statuses: BOOKING_NUMBER_HOLDING_STATUSES,
    });
  }

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
   * Marks a Trip BETAALD or NIET BETAALD.
   *
   * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
   * It does not touch the status, and it cannot: `setPaid` writes one column,
   * so there is no transition to allow or refuse and no state machine to
   * consult. Payment is independent of the lifecycle — a Trip is paid or unpaid
   * whether it is OPEN, CLOSED or CANCELLED — and marking one paid must never
   * close it, just as marking one unpaid must never reopen it.
   *
   * It also touches no pricing. What a Trip is WORTH and whether it has been
   * PAID are different questions with different owners; no snapshot, override
   * or recalculation is involved here.
   *
   * ── IDEMPOTENT ────────────────────────────────────────────────────────────
   * Asking for the state a Trip already has writes nothing and answers with the
   * Trip, exactly as `changeStatus` does. A double click is not an error.
   *
   * The Trip's existence is verified first, so an unknown id is the same 404 it
   * is everywhere else.
   */
  async changePayment(
    id: string,
    dto: ChangeTripPaymentDto,
  ): Promise<TripResponseDto> {
    const trip = await this.requireTrip(id);

    if (trip.isPaid === dto.isPaid) {
      return this.toResponse(trip);
    }

    const updated = await this.repository.setPaid(id, dto.isPaid);

    // The state is an identifier-level fact, not a business value: what was
    // paid is money and stays out of the log, whether it was paid does not.
    this.logger.log("Trip payment state changed", {
      tripId: id,
      isPaid: updated.isPaid,
      // Logged to make the independence auditable rather than merely claimed.
      tripStatus: updated.status,
    });

    return this.toResponse(updated);
  }

  /**
   * Marks several Trips CLOSED in one operation.
   *
   * ── THE SAME RULE, APPLIED TO EACH ────────────────────────────────────────
   * There is no second lifecycle here. Every Trip is checked with
   * `assertTransitionAllowed`, the same state machine the single-Trip endpoint
   * uses, and a Trip already CLOSED is left alone exactly as `changeStatus`
   * leaves it — asking for the status something already has is not a change.
   *
   * ── ALL OR NOTHING ────────────────────────────────────────────────────────
   * Every Trip is validated BEFORE anything is written, and the writes share one
   * transaction. So a selection containing one cancelled Trip closes none of
   * them and says which one was in the way, rather than closing four and
   * leaving the operator to work out what happened to the fifth.
   *
   * That is the convention this codebase already has for a multi-Trip
   * operation: grouping is one transaction, "either every Trip joins or none
   * does", for the same reason.
   *
   * ── PRICING IS NOT PART OF IT ─────────────────────────────────────────────
   * Closing announces itself once per Trip after the commit, and pricing
   * happens on that announcement — outside this transaction, as it already does
   * for a single Trip. A Trip whose route is not configured still closes: the
   * absence of a price is a configuration fact to look at later, never a reason
   * to refuse an operator's completion.
   * ──────────────────────────────────────────────────────────────────────────
   */
  async completeMany(tripIds: readonly string[]): Promise<TripResponseDto[]> {
    const trips = await this.repository.findManyByIds(tripIds);

    this.assertAllTripsExist(tripIds, trips);

    // Checked in full first: a refusal must leave every Trip untouched.
    const toClose = trips.filter((trip) => trip.status !== TripStatus.CLOSED);

    for (const trip of toClose) {
      this.assertTransitionAllowed(trip.status, TripStatus.CLOSED);
    }

    const closed = await this.repository.runInTransaction(
      async (repository) => {
        const written: Trip[] = [];

        for (const trip of toClose) {
          written.push(await repository.setStatus(trip.id, TripStatus.CLOSED));
        }

        return written;
      },
    );

    this.logger.log("Trips completed", {
      tripIds: trips.map((trip) => trip.id),
      closedCount: closed.length,
      alreadyClosedCount: trips.length - closed.length,
    });

    /*
     * After the commit, one announcement per Trip that actually moved — the
     * same event a single completion publishes, so pricing behaves identically
     * however the Trip was closed.
     */
    for (const trip of closed) {
      await this.announceIfClosed(trip);
    }

    // Every requested Trip, in the order the caller asked for them, whether it
    // moved now or was already closed.
    const byId = new Map(
      [...trips, ...closed].map((trip) => [trip.id, trip] as const),
    );

    return this.toResponses(
      tripIds.map((id) => byId.get(id) as Trip),
    );
  }

  /**
   * Marks several Trips as LOSRIT in one request.
   *
   * ── A CLASSIFICATION, NOT A TRANSITION ────────────────────────────────────
   * This writes ONE column. It touches no status, no planning date, no booking
   * number, no container, no vehicle, no driver, no custom property, no group
   * and no document — and it publishes nothing, so no pricing runs. A LOSRIT is
   * what the operator calls the Trip; it is not something that happens to it.
   *
   * ── WHY A GROUPED TRIP IS REFUSED ─────────────────────────────────────────
   * A losrit is a loose trip, and a leg of a Combination is by definition not
   * loose. The database does not forbid the combination — the two columns are
   * independent, and a Trip that was already a LOSRIT before it joined a group
   * keeps its classification — so this is a rule of the operation rather than
   * an invariant of the data.
   *
   * ── ALL OR NOTHING ────────────────────────────────────────────────────────
   * Every Trip is checked before any is written. A selection of one ungrouped
   * and one grouped Trip changes NEITHER: applying it to the half that
   * qualifies would leave the operator with a partly-done action they did not
   * ask for and cannot see the shape of.
   *
   * A Trip that is already a LOSRIT is left alone rather than refused, so the
   * action is idempotent and a mixed selection needs no thought from the
   * operator.
   */
  async markManyLoose(tripIds: readonly string[]): Promise<TripResponseDto[]> {
    const trips = await this.repository.findManyByIds(tripIds);

    this.assertAllTripsExist(tripIds, trips);

    for (const trip of trips) {
      if (trip.status === TripStatus.DELETED) {
        throw new DeletedTripCannotBeLooseException(trip.id);
      }

      if (trip.tripGroupId !== null) {
        throw new GroupedTripCannotBeLooseException(trip.id, trip.tripGroupId);
      }
    }

    // Already classified: nothing to write, and nothing to report as changed.
    const toMark = trips.filter((trip) => !trip.isLooseTrip);

    const marked = await this.repository.runInTransaction(
      async (repository) => {
        const written: Trip[] = [];

        for (const trip of toMark) {
          written.push(await repository.update(trip.id, { isLooseTrip: true }));
        }

        return written;
      },
    );

    this.logger.log("Trips marked as loose", {
      tripIds: trips.map((trip) => trip.id),
      markedCount: marked.length,
      alreadyLooseCount: trips.length - marked.length,
    });

    // Every requested Trip, in the order the caller asked for them, whether it
    // was written now or already carried the classification.
    const byId = new Map(
      [...trips, ...marked].map((trip) => [trip.id, trip] as const),
    );

    return this.toResponses(tripIds.map((id) => byId.get(id) as Trip));
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
    const created = await this.repository.runTripWriteTransaction(
      async ({ trips, pdfDocuments, customProperties }) => {
        /*
         * A document already stored is used as it is. Only a brand-new one is
         * written here, inside the transaction, so that a failed import leaves
         * neither Trips nor a row describing a document nobody has.
         */
        const pdfDocumentId =
          command.document.kind === "stored"
            ? command.document.id
            : (await pdfDocuments.create(command.document.data)).id;

        const tripGroup = command.asCombination
          ? await trips.createTripGroup()
          : null;

        const written: Trip[] = [];

        for (const trip of command.trips) {
          await this.assertIdentityFree(trips, {
            bookingNumber: trip.bookingNumber,
            containerNumber: trip.containerNumber,
          });

          const stored = await trips.create({
            pdfDocumentId,
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
          });

          // Same rule, same transaction. The document only states the container
          // type; what that type obliges is this domain's decision.
          await this.automaticFlat.applyToNewTrip(
            customProperties,
            stored.id,
            stored.containerType,
          );

          written.push(stored);
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

    if (!DELETABLE_FROM_STATUSES.includes(trip.status)) {
      throw new TripNotDeletableException(
        id,
        trip.status,
        DELETABLE_FROM_STATUSES,
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
   * the booking could never be re-entered. `trip_identity_key` expresses the
   * same rule in the database — partial, and `NULLS NOT DISTINCT` so an absent
   * container number counts as a value — but the check stays here so a clash is
   * a domain refusal rather than a constraint violation surfacing as a 500.
   */
  private async assertIdentityFree(
    repository: TripRepository,
    identity: TripIdentity,
    excludeTripId?: string,
  ): Promise<void> {
    const holder = await repository.findByIdentity({
      identity,
      statuses: BOOKING_NUMBER_HOLDING_STATUSES,
      excludeTripId,
    });

    if (holder) {
      this.logger.warn("Rejected duplicate Trip identity", {
        tripId: excludeTripId,
        conflictingTripId: holder.id,
      });

      throw new DuplicateBookingNumberException(
        identity.bookingNumber,
        holder.id,
        identity.containerNumber,
      );
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
   * Re-acquires the identity a Trip gave up.
   *
   * Only the identity: a Vehicle is no longer exclusive to one interval, so a
   * restored Trip cannot be refused on the grounds that its truck has since
   * been planned elsewhere.
   *
   * The whole identity, not the booking number alone — another Trip may have
   * been created for the SAME booking with a different container while this one
   * was deleted, and that one is not in the way.
   */
  private async assertReclaimable(
    repository: TripRepository,
    trip: Trip,
  ): Promise<void> {
    // A Trip with no booking number has no identity to re-acquire. Uniqueness
    // applies to the booking numbers that exist, and absence is not a value
    // that can collide.
    if (trip.bookingNumber === null) {
      return;
    }

    await this.assertIdentityFree(
      repository,
      {
        bookingNumber: trip.bookingNumber,
        containerNumber: trip.containerNumber,
      },
      trip.id,
    );
  }

  /**
   * A waiting-time window is both times or neither.
   *
   * It cannot be a DTO decorator: `@IsOptional()` skips every validator on a
   * property that was not sent, which is precisely the case here — a start on
   * its own, with the end absent. So the rule lives where it can see both.
   */
  private assertWaitingWindowIsComplete(dto: UpdateTripDto): void {
    const sent = [dto.waitingTimeStart, dto.waitingTimeEnd].filter(
      (value) => value !== undefined,
    );

    if (sent.length === 0) {
      return;
    }

    const isComplete =
      sent.length === 2 &&
      (sent.every((value) => value === null) ||
        sent.every((value) => value !== null));

    if (!isComplete) {
      throw new IncompleteWaitingWindowException();
    }
  }

  /**
   * Who owns the fields a transport order states.
   *
   * A Trip created by hand has no source document, so the operator is the only
   * possible author of its destination — and until now there was no way to
   * change one entered wrongly, because it was excluded from every update as
   * "parser-controlled". That description is only true where a parser exists.
   *
   * On an IMPORTED Trip it still is: a later UPDATE document re-reads the
   * destination and would overwrite anything typed here, so the request is
   * refused rather than accepted and silently reverted.
   *
   * ── THE TRANSPORT TIMES ARE NOT ON THIS LIST ─────────────────────────────
   * They used to be, and the owner decided otherwise: Begin and Eind are
   * planning an operator adjusts as a day unfolds, on any Trip, exactly like
   * the planning date beside them. A document may still revise them — that is
   * what a later UPDATE is for — and until one does, the operator's value
   * stands. An edit made here is an operator edit and writes no history: only
   * a document's revision does that, through TripRevisionService.
   *
   * Only a field actually being SENT is checked. An update that leaves them
   * alone is not a change to them, whatever the Trip's origin.
   *
   * There is deliberately no rule that the end must follow the start. A
   * transport running past midnight is ordinary, and a single-time order stores
   * the same value in both — inventing an ordering rule here would refuse
   * planning the parser itself produces.
   */
  private assertDocumentFieldsEditable(trip: Trip, dto: UpdateTripDto): void {
    if (trip.pdfDocumentId === null) {
      return;
    }

    const owned: ReadonlyArray<[keyof UpdateTripDto, string]> = [
      ["destinationCity", "destination"],
      ["destinationCountry", "destination"],
    ];

    for (const [field, description] of owned) {
      if (dto[field] !== undefined) {
        throw new DocumentControlledFieldException(
          trip.id,
          trip.pdfDocumentId,
          description,
        );
      }
    }
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
      containerNumber:
        dto.containerNumber === undefined
          ? undefined
          : toContainerIdentity(dto.containerNumber),
      planningDate:
        dto.planningDate === undefined
          ? undefined
          : toUtcDate(dto.planningDate),
      vehicleId: dto.vehicleId,
      driverId: dto.driverId,
      distanceKm: dto.distanceKm,
      executionDatetime:
        dto.executionDatetime === undefined
          ? undefined
          : toNullableDateTime(dto.executionDatetime),
      internalNotes: dto.internalNotes,
      /*
       * Both times, or both cleared, or neither mentioned — and the duration
       * follows from them. `waitingTimeMinutes` is not accepted from a caller
       * at all, which is what keeps the money and its evidence in step.
       */
      ...toWaitingTimeWrite(
        dto.waitingTimeStart === undefined
          ? undefined
          : toNullableTime(dto.waitingTimeStart),
        dto.waitingTimeEnd === undefined
          ? undefined
          : toNullableTime(dto.waitingTimeEnd),
      ),
      destinationCity: dto.destinationCity,
      destinationCountry: dto.destinationCountry,
      startTime:
        dto.startTime === undefined ? undefined : toNullableTime(dto.startTime),
      endTime:
        dto.endTime === undefined ? undefined : toNullableTime(dto.endTime),
      isLooseTrip: dto.isLooseTrip,
    };
  }
}

/**
 * The waiting-time columns for a Trip being created.
 *
 * The window wins when both times are given, because the duration then follows
 * from them. With no window the supplied duration is stored on its own — which
 * is how a Trip imported from a document, or entered before the two times were
 * recorded, legitimately looks.
 */
function toWaitingTimeOnCreate(dto: CreateTripDto): {
  waitingTimeStart: Date | null;
  waitingTimeEnd: Date | null;
  waitingTimeMinutes: number | null;
} {
  const window = toWaitingTimeWrite(
    dto.waitingTimeStart === undefined
      ? undefined
      : toNullableTime(dto.waitingTimeStart),
    dto.waitingTimeEnd === undefined
      ? undefined
      : toNullableTime(dto.waitingTimeEnd),
  );

  return {
    waitingTimeStart: window.waitingTimeStart ?? null,
    waitingTimeEnd: window.waitingTimeEnd ?? null,
    waitingTimeMinutes:
      window.waitingTimeMinutes ?? dto.waitingTimeMinutes ?? null,
  };
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
