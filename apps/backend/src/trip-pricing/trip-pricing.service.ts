import { Injectable } from "@nestjs/common";
import { PricingCalculationStatus, Prisma, TripPricing } from "@prisma/client";

import { changedFieldNames } from "../common/changed-fields";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripService } from "../trips/trip.service";
import { toTripPricingItemResponse } from "../trip-pricing-items/dto/trip-pricing-item-response.dto";
import { PricingSnapshotDto } from "./dto/pricing-snapshot.dto";
import {
  TripPricingResponseDto,
  toTripPricingResponse,
} from "./dto/trip-pricing-response.dto";
import { UpdateTripPricingDto } from "./dto/update-trip-pricing.dto";
import {
  DuplicateTripPricingException,
  TripPricingNotFoundException,
} from "./exceptions/trip-pricing.exceptions";
import { TripPricingRepository } from "./trip-pricing.repository";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/** One calculated line, ready to be stored. No arithmetic remains. */
export interface PricingSnapshotItemData {
  readonly pricingComponentId: string;
  readonly customPropertyId: string | null;
  readonly description: string;
  readonly amount: Prisma.Decimal;
  readonly calculationOrder: number;
  readonly quantity: Prisma.Decimal | null;
  readonly unitPrice: Prisma.Decimal | null;
}

/**
 * A complete snapshot to store, parent and breakdown together.
 *
 * Carries no DTO and passes through no validation pipe: this is an internal
 * command from the Pricing Engine, not a request. Every amount is already
 * calculated and rounded, and nothing here is recomputed.
 */
export interface ReplacePricingSnapshotCommand {
  readonly tripId: string;
  readonly totalPrice: Prisma.Decimal;
  readonly calculatedAt: Date;
  readonly pricingEngineVersion: string;
  readonly pricingRuleVersion: string;
  readonly calculationStatus: PricingCalculationStatus;
  readonly items: readonly PricingSnapshotItemData[];
}

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
   * The stored pricing of many Trips, for an export.
   *
   * Existence of each Trip is deliberately NOT checked: this is a bulk read for
   * a set of Trips the caller already has, and one 404 would fail a whole
   * export because a Trip was deleted between listing and exporting. A Trip
   * that is unknown or unpriced is simply absent from the result, which is the
   * same answer either way — there is no pricing to show.
   *
   * Nothing is calculated. These are the lines the Pricing Engine already
   * wrote.
   */
  async findManyByTripIds(
    tripIds: readonly string[],
  ): Promise<PricingSnapshotDto[]> {
    const snapshots = await this.repository.findManyByTripIds(tripIds);

    return snapshots.map((snapshot) => ({
      pricing: toTripPricingResponse(snapshot),
      items: snapshot.items.map(toTripPricingItemResponse),
    }));
  }

  /**
   * Stores a complete snapshot produced by the Pricing Engine, atomically.
   *
   * Parent and breakdown are written in ONE transaction, so a failure anywhere
   * leaves the database exactly as it was. That is what makes the stored total
   * trustworthy: `trip_pricing.total_price` must equal the sum of its items,
   * and a half-written snapshot would break that invariant while looking
   * perfectly valid to a reader.
   *
   * A first calculation creates the parent; a reprocess UPDATES the existing
   * one, so the snapshot keeps its identity and anything referring to it stays
   * valid. Its items are discarded and rewritten in full — a component that no
   * longer applies must not survive as a stale charge.
   *
   * Internal to the application. There is deliberately no REST route to this:
   * replacing a breakdown is one indivisible operation, and exposing its halves
   * would let a caller create exactly the inconsistent state the transaction
   * exists to prevent.
   *
   * The Trip's status is not re-checked here. The Engine validates it before
   * calculating anything, and re-reading the Trip inside the transaction would
   * add a second source of truth and lengthen a transaction that should stay
   * short.
   *
   * Currency is left to the column default, which is EUR for both tables. It is
   * defined in one place, and pricing is EUR by rule rather than by choice.
   */
  async replaceSnapshot(
    command: ReplacePricingSnapshotCommand,
  ): Promise<TripPricingResponseDto> {
    const stored = await this.runGuardingTrip(command.tripId, () =>
      this.repository.runInTransaction(async ({ pricing, items }) => {
        const existing = await pricing.findByTripId(command.tripId);

        const parent = existing
          ? await pricing.update(existing.id, {
              totalPrice: command.totalPrice,
              calculatedAt: command.calculatedAt,
              pricingEngineVersion: command.pricingEngineVersion,
              pricingRuleVersion: command.pricingRuleVersion,
              calculationStatus: command.calculationStatus,
            })
          : await pricing.create({
              tripId: command.tripId,
              totalPrice: command.totalPrice,
              calculatedAt: command.calculatedAt,
              pricingEngineVersion: command.pricingEngineVersion,
              pricingRuleVersion: command.pricingRuleVersion,
              calculationStatus: command.calculationStatus,
            });

        if (existing) {
          await items.deleteByTripPricingId(parent.id);
        }

        await items.createMany(
          command.items.map((item) => ({
            tripPricingId: parent.id,
            pricingComponentId: item.pricingComponentId,
            customPropertyId: item.customPropertyId,
            description: item.description,
            amount: item.amount,
            calculationOrder: item.calculationOrder,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        );

        return { parent, wasReplaced: existing !== null };
      }),
    );

    // Neither the total nor any line amount is logged: both are commercial
    // information. The counts are what an administrator traces.
    this.logger.log("Pricing snapshot stored", {
      tripPricingId: stored.parent.id,
      tripId: stored.parent.tripId,
      calculationStatus: stored.parent.calculationStatus,
      itemCount: command.items.length,
      wasReplaced: stored.wasReplaced,
    });

    return toTripPricingResponse(stored.parent);
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
