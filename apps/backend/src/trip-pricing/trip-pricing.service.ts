import { Injectable } from "@nestjs/common";
import { Prisma, TripPricing, TripStatus } from "@prisma/client";

import { changedFieldNames } from "../common/changed-fields";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripService } from "../trips/trip.service";
import { CreateTripPricingDto } from "./dto/create-trip-pricing.dto";
import {
  TripPricingResponseDto,
  toTripPricingResponse,
} from "./dto/trip-pricing-response.dto";
import { UpdateTripPricingDto } from "./dto/update-trip-pricing.dto";
import {
  DuplicateTripPricingException,
  TripNotClosedException,
  TripPricingNotFoundException,
} from "./exceptions/trip-pricing.exceptions";
import { TripPricingRepository } from "./trip-pricing.repository";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/** A pricing snapshot may only exist once its Trip has reached this status. */
const PRICEABLE_TRIP_STATUS = TripStatus.CLOSED;

/**
 * Stores pricing snapshots. It never calculates one.
 *
 * The future Pricing Engine performs the arithmetic and calls this module to
 * persist the outcome; every amount arrives from the caller and is written
 * verbatim. There is no formula, no rate, no percentage and no summation here,
 * and there must never be — pricing logic belongs in exactly one place.
 *
 * Monetary values are never written to the log: a total, a currency and the
 * notes explaining a calculation are commercial information. Only identifiers,
 * the calculation status and changed field names are logged, which is enough to
 * trace a snapshot without exposing what it is worth.
 */
@Injectable()
export class TripPricingService {
  constructor(
    private readonly repository: TripPricingRepository,
    private readonly tripService: TripService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripPricingService.name);
  }

  async findById(id: string): Promise<TripPricingResponseDto> {
    return toTripPricingResponse(await this.requireTripPricing(id));
  }

  /**
   * The snapshot belonging to a Trip, or null when it has none.
   *
   * Null rather than 404: a CLOSED Trip awaiting its first calculation, and a
   * Trip that will never be priced, are both ordinary states. The Trip's own
   * existence is still verified, so an unknown Trip is reported as 404 instead
   * of being reported as "no pricing".
   */
  async findByTripId(tripId: string): Promise<TripPricingResponseDto | null> {
    // Delegating existence to TripService reuses its lookup and its 404 rather
    // than duplicating either here.
    await this.tripService.findById(tripId);

    const tripPricing = await this.repository.findByTripId(tripId);

    return tripPricing ? toTripPricingResponse(tripPricing) : null;
  }

  /**
   * Persists a snapshot produced by the Pricing Engine.
   *
   * Both preconditions come from the model: a snapshot only exists for a CLOSED
   * Trip, and a Trip has at most one. Neither can be expressed as a database
   * constraint on its own — the first is a cross-table conditional existence,
   * and the second is only half-covered by the unique index, which cannot
   * produce a useful message on its own.
   */
  async create(dto: CreateTripPricingDto): Promise<TripPricingResponseDto> {
    await this.assertTripIsPriceable(dto.tripId);
    await this.assertTripHasNoPricing(dto.tripId);

    const created = await this.runGuardingTrip(dto.tripId, () =>
      this.repository.create({
        tripId: dto.tripId,
        totalPrice: dto.totalPrice,
        calculatedAt: new Date(dto.calculatedAt),
        pricingEngineVersion: dto.pricingEngineVersion,
        pricingRuleVersion: dto.pricingRuleVersion,
        calculationStatus: dto.calculationStatus,
        notes: dto.notes ?? null,
      }),
    );

    // The total is never logged: it is commercial information.
    this.logger.log("Pricing snapshot created", {
      tripPricingId: created.id,
      tripId: created.tripId,
      calculationStatus: created.calculationStatus,
    });

    return toTripPricingResponse(created);
  }

  /**
   * Updates the calculation metadata.
   *
   * Nothing is recalculated and no amount changes: the DTO exposes only the
   * status and the note, so the stored total keeps belonging to the run that
   * produced it.
   */
  async update(
    id: string,
    dto: UpdateTripPricingDto,
  ): Promise<TripPricingResponseDto> {
    const existing = await this.requireTripPricing(id);

    const updated = await this.repository.update(id, {
      calculationStatus: dto.calculationStatus,
      notes: dto.notes,
    });

    this.logger.log("Pricing snapshot updated", {
      tripPricingId: id,
      tripId: existing.tripId,
      changedFields: changedFieldNames(dto),
    });

    this.logStatusChange(existing, updated);

    return toTripPricingResponse(updated);
  }

  private async requireTripPricing(id: string): Promise<TripPricing> {
    const tripPricing = await this.repository.findById(id);

    if (!tripPricing) {
      throw new TripPricingNotFoundException(id);
    }

    return tripPricing;
  }

  /** Verifies the Trip exists and has reached the status that permits pricing. */
  private async assertTripIsPriceable(tripId: string): Promise<void> {
    const trip = await this.tripService.findById(tripId);

    if (trip.status !== PRICEABLE_TRIP_STATUS) {
      this.logger.warn("Rejected pricing snapshot for a Trip that is not closed", {
        tripId,
        tripStatus: trip.status,
      });

      throw new TripNotClosedException(
        tripId,
        trip.status,
        PRICEABLE_TRIP_STATUS,
      );
    }
  }

  private async assertTripHasNoPricing(tripId: string): Promise<void> {
    const existing = await this.repository.findByTripId(tripId);

    if (existing) {
      this.logger.warn("Rejected duplicate pricing snapshot", {
        tripId,
        conflictingTripPricingId: existing.id,
      });

      throw new DuplicateTripPricingException(tripId);
    }
  }

  /**
   * The check above is a courtesy that produces a good error message; it cannot
   * be atomic. The unique index on trip_id is the real guard, so its violation
   * is translated here rather than escaping as a raw Prisma error.
   */
  private async runGuardingTrip<TResult>(
    tripId: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        throw new DuplicateTripPricingException(tripId);
      }

      throw error;
    }
  }

  /**
   * A status change is its own event.
   *
   * It is logged separately from the general update, because the pricing
   * lifecycle is what an administrator traces when a calculation is questioned,
   * and burying it inside a list of changed field names would hide it.
   */
  private logStatusChange(previous: TripPricing, current: TripPricing): void {
    if (previous.calculationStatus === current.calculationStatus) {
      return;
    }

    this.logger.log("Pricing calculation status changed", {
      tripPricingId: current.id,
      tripId: current.tripId,
      fromStatus: previous.calculationStatus,
      toStatus: current.calculationStatus,
    });
  }
}
