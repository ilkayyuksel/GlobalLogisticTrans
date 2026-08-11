import { Injectable } from "@nestjs/common";
import { Prisma, Trip, TripStatus } from "@prisma/client";

import { changedFieldNames } from "../common/changed-fields";
import { toUtcDate } from "../common/dates";
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
import {
  AssignmentSubject,
  DuplicateBookingNumberException,
  InactiveAssignmentException,
  InvalidTripStatusTransitionException,
  TripNotDeletableException,
  TripNotDeletedException,
  TripNotFoundException,
  UnknownPdfDocumentException,
  VehicleAlreadyBookedException,
} from "./exceptions/trip.exceptions";
import {
  BOOKING_NUMBER_HOLDING_STATUSES,
  DELETABLE_FROM_STATUS,
  RESTORED_STATUS,
  VEHICLE_OCCUPYING_STATUSES,
  allowedTransitionsFrom,
  canTransition,
} from "./trip-status.rules";
import { TripRepository } from "./trip.repository";

/** DELETED Trips must not appear in normal planning views. */
const HIDDEN_BY_DEFAULT_STATUSES: readonly TripStatus[] = [TripStatus.DELETED];

/**
 * The planned interval of a Trip, once both ends are known.
 *
 * A Trip missing either end has no interval that can be compared, so it takes
 * no part in overlap detection.
 */
interface PlannedInterval {
  planningDate: Date;
  startTime: Date;
  endTime: Date;
}

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
@Injectable()
export class TripService {
  constructor(
    private readonly repository: TripRepository,
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripService.name);
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
      terminal: query.terminal,
      destinationCity: query.destinationCity,
      destinationCountry: query.destinationCountry,
      search: query.search,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map(toTripResponse),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  async findById(id: string): Promise<TripResponseDto> {
    return toTripResponse(await this.requireTrip(id));
  }

  /**
   * Creates a Trip by hand.
   *
   * Everything that can be checked without writing is checked first, so a
   * rejected request never leaves a partially valid row behind. The booking and
   * overlap checks then run inside the transaction that performs the insert,
   * keeping the window in which a concurrent write could slip between them as
   * small as the database allows.
   */
  async create(dto: CreateTripDto): Promise<TripResponseDto> {
    await this.assertPdfDocumentExists(dto.pdfDocumentId);
    await this.assertAssignable("vehicle", dto.vehicleId);
    await this.assertAssignable("driver", dto.driverId);

    const planningDate = toUtcDate(dto.planningDate);
    const startTime = toNullableTime(dto.startTime);
    const endTime = toNullableTime(dto.endTime);

    const created = await this.repository.runInTransaction(
      async (repository) => {
        await this.assertBookingNumberFree(repository, dto.bookingNumber);
        await this.assertVehicleFree(
          repository,
          dto.vehicleId ?? null,
          toPlannedInterval(planningDate, startTime, endTime),
        );

        return repository.create({
          pdfDocumentId: dto.pdfDocumentId,
          bookingNumber: dto.bookingNumber,
          containerNumber: dto.containerNumber ?? null,
          containerType: dto.containerType,
          terminal: dto.terminal ?? null,
          destinationCity: dto.destinationCity,
          destinationCountry: dto.destinationCountry,
          originalPlanningDate: toUtcDate(dto.originalPlanningDate),
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

    return toTripResponse(created);
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

    const planningDate =
      dto.planningDate === undefined
        ? existing.planningDate
        : toUtcDate(dto.planningDate);
    const vehicleId =
      dto.vehicleId === undefined ? existing.vehicleId : dto.vehicleId;

    const updated = await this.repository.runInTransaction(
      async (repository) => {
        // The interval itself cannot be edited here, but moving the Trip to
        // another day or onto another Vehicle re-opens the booking question.
        await this.assertVehicleFree(
          repository,
          vehicleId,
          toPlannedInterval(planningDate, existing.startTime, existing.endTime),
          id,
        );

        return repository.update(id, this.toUpdateData(dto));
      },
    );

    this.logger.log("Trip updated", {
      tripId: id,
      changedFields: changedFieldNames(dto),
    });

    return toTripResponse(updated);
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
      return toTripResponse(trip);
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

    return toTripResponse(changed);
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
      return toTripResponse(trip);
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

    return toTripResponse(deleted);
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

    return toTripResponse(restored);
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
   * Booking numbers identify a transport order.
   *
   * The database index is deliberately non-unique, because the two Trips of a
   * Combination share one booking number, so this rule can only be enforced
   * here. A DELETED Trip does not hold its booking number: soft delete is the
   * documented remedy for a Trip created in error, and it would be no remedy if
   * the booking could never be re-entered.
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

  /**
   * A Vehicle cannot serve two Trips whose planned intervals overlap.
   *
   * Only Trips that actually occupy the Vehicle count: a cancelled transport
   * has released it and a deleted record never held it. A Trip without both
   * times has no comparable interval, so it neither blocks nor is blocked —
   * the model does not define what an open-ended planned interval occupies.
   */
  private async assertVehicleFree(
    repository: TripRepository,
    vehicleId: string | null,
    interval: PlannedInterval | null,
    excludeTripId?: string,
  ): Promise<void> {
    if (!vehicleId || !interval) {
      return;
    }

    const [conflict] = await repository.findVehicleOverlaps({
      vehicleId,
      ...interval,
      statuses: VEHICLE_OCCUPYING_STATUSES,
      excludeTripId,
    });

    if (conflict) {
      this.logger.warn("Rejected overlapping vehicle booking", {
        tripId: excludeTripId,
        vehicleId,
        conflictingTripId: conflict.id,
      });

      throw new VehicleAlreadyBookedException(vehicleId, conflict.id);
    }
  }

  /** Re-acquires the booking number and Vehicle slot a Trip gave up. */
  private async assertReclaimable(
    repository: TripRepository,
    trip: Trip,
  ): Promise<void> {
    await this.assertBookingNumberFree(
      repository,
      trip.bookingNumber,
      trip.id,
    );
    await this.assertVehicleFree(
      repository,
      trip.vehicleId,
      toPlannedInterval(trip.planningDate, trip.startTime, trip.endTime),
      trip.id,
    );
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
        dto.planningDate === undefined ? undefined : toUtcDate(dto.planningDate),
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

/** An interval exists only when both ends are known. */
function toPlannedInterval(
  planningDate: Date,
  startTime: Date | null,
  endTime: Date | null,
): PlannedInterval | null {
  if (!startTime || !endTime) {
    return null;
  }

  return { planningDate, startTime, endTime };
}

function toNullableTime(value: string | null | undefined): Date | null {
  return value ? toUtcTime(value) : null;
}

function toNullableDateTime(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}
