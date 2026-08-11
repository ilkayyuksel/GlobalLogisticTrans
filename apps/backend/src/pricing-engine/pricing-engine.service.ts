import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripResponseDto } from "../trips/dto/trip-response.dto";
import { TripService } from "../trips/trip.service";
import {
  TripNotFoundForPricingException,
  TripNotPriceableException,
} from "./exceptions/pricing-engine.exceptions";
import { PricingCalculationContext } from "./pricing-calculation-context";
import {
  PricingCalculationResult,
  PricingPreparation,
} from "./pricing-calculation-result";
import { PricingComponentResolver } from "./pricing-component.resolver";
import {
  PRICING_CALCULATION_STEPS,
  PricingCalculationStep,
  PricingLine,
} from "./pricing-line";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";

/** pricing_rules.md: pricing exists only for a finished Trip. */
const PRICEABLE_TRIP_STATUS = TripStatus.CLOSED;

/** A Trip with no recorded waiting time waited zero minutes. */
const NO_WAITING_TIME_MINUTES = 0;

/**
 * The Pricing Engine.
 *
 * A domain service, not a CRUD module and not a REST module: it has no
 * controller, no repository and no table of its own. It orchestrates, and the
 * modules it orchestrates own their data.
 *
 * It reads exclusively through Services. It never touches Prisma and never
 * touches a repository, which is what keeps every business rule those modules
 * enforce — a Trip's status, an inactive Setting, an inactive Custom Property —
 * true for the Engine too, instead of being re-implemented here and drifting.
 *
 * The Engine resolves and validates the inputs of a calculation, then runs the
 * ordered sequence of calculation steps over them. It still writes nothing and
 * produces no snapshot: persistence is a later phase, and keeping calculation
 * separate from storage is what lets a result be inspected before it is kept.
 *
 * The steps themselves are injected as an ordered list rather than called one
 * by one, because pricing_rules.md defines the sequence and warns that changing
 * the order changes the result. Adding a component means adding a step to that
 * list; no existing step and no line of this service changes.
 *
 * Monetary values are never logged. Only identifiers, the strategy, Setting
 * KEYS, line counts and timings appear in the log.
 */
@Injectable()
export class PricingEngineService {
  constructor(
    private readonly tripService: TripService,
    private readonly ruleResolver: PricingRuleResolver,
    private readonly componentResolver: PricingComponentResolver,
    private readonly snapshotWriter: PricingSnapshotWriter,
    @Inject(PRICING_CALCULATION_STEPS)
    private readonly calculationSteps: readonly PricingCalculationStep[],
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PricingEngineService.name);
  }

  /**
   * Prices a Trip.
   *
   * Resolves the inputs, then runs every calculation step in the configured
   * order, handing each of them what the earlier steps produced. Nothing is
   * stored: the result is returned for a caller to inspect, and the persistence
   * phase will be responsible for keeping it.
   */
  async calculate(tripId: string): Promise<PricingCalculationResult> {
    const preparation = await this.prepareCalculation(tripId);
    const lines = this.runCalculationSteps(preparation.context);

    this.logger.log("Pricing calculation produced lines", {
      tripId,
      strategy: preparation.context.rules.strategy,
      lineCount: lines.length,
      components: lines.map((line) => line.component),
    });

    return { ...preparation, lines };
  }

  /**
   * Runs the sequence, accumulating lines as it goes.
   *
   * Each step receives the lines produced before it, because later components
   * depend on earlier ones — the Fuel Surcharge applies to the base price
   * alone. The accumulated list is copied into each call so a step cannot
   * mutate what a previous one produced.
   */
  private runCalculationSteps(
    context: PricingCalculationContext,
  ): PricingLine[] {
    const lines: PricingLine[] = [];

    for (const step of this.calculationSteps) {
      lines.push(...step.calculate(context, [...lines]));
    }

    return lines;
  }

  /**
   * Resolves and validates everything one pricing calculation needs, without
   * calculating anything.
   *
   * Useful on its own: it answers whether a Trip could be priced right now, and
   * against which configuration, without producing an amount.
   *
   * Inputs are resolved in dependency order — the Trip first, because its
   * status decides whether anything else is worth loading; then the rules,
   * because the strategy decides which Trip inputs matter; then the per-Trip
   * inputs. A failure at any step aborts before the later, more expensive
   * lookups run.
   */
  async prepareCalculation(tripId: string): Promise<PricingPreparation> {
    this.logger.log("Pricing calculation requested", { tripId });

    const startedAtMs = Date.now();

    this.logger.log("Pricing calculation started", { tripId });

    const trip = await this.requirePriceableTrip(tripId);
    const rules = await this.ruleResolver.resolve();
    const baseSource = await this.componentResolver.resolveBaseSource(
      trip,
      rules,
    );
    const activeCustomProperties =
      await this.componentResolver.resolveActiveCustomProperties();
    const existingSnapshot =
      await this.snapshotWriter.findExistingSnapshot(tripId);

    const preparedAt = new Date();
    const context: PricingCalculationContext = {
      tripId: trip.id,
      bookingNumber: trip.bookingNumber,
      tripStatus: trip.status,
      planningDate: trip.planningDate,
      isCombination: trip.tripGroupId !== null,
      waitingTimeMinutes: trip.waitingTimeMinutes ?? NO_WAITING_TIME_MINUTES,
      baseSource,
      rules,
      activeCustomProperties,
      existingSnapshot,
      preparedAt,
    };

    const durationMs = Date.now() - startedAtMs;

    this.logger.log("Pricing calculation finished", {
      tripId,
      strategy: rules.strategy,
      isCombination: context.isCombination,
      isReprocess: existingSnapshot !== null,
      customPropertyCount: activeCustomProperties.length,
      durationMs,
    });

    return {
      tripId: trip.id,
      context,
      isReprocess: existingSnapshot !== null,
      preparedAt,
      durationMs,
    };
  }

  /**
   * Loads the Trip and confirms it may be priced.
   *
   * TripService reports absence as an HTTP 404. It is translated here so a
   * domain service never leaks a transport-level error to its callers, which
   * may be a queue worker or a scheduled job rather than a request.
   */
  private async requirePriceableTrip(
    tripId: string,
  ): Promise<TripResponseDto> {
    const trip = await this.findTrip(tripId);

    if (!trip) {
      this.logger.warn("Pricing requested for an unknown Trip", { tripId });

      throw new TripNotFoundForPricingException(tripId);
    }

    if (trip.status !== PRICEABLE_TRIP_STATUS) {
      this.logger.warn("Pricing requested for a Trip that is not closed", {
        tripId,
        tripStatus: trip.status,
      });

      throw new TripNotPriceableException(
        tripId,
        trip.status,
        PRICEABLE_TRIP_STATUS,
      );
    }

    return trip;
  }

  private async findTrip(tripId: string): Promise<TripResponseDto | null> {
    try {
      return await this.tripService.findById(tripId);
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }
}
