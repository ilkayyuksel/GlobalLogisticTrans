import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PricingCalculationStatus, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripResponseDto } from "../trips/dto/trip-response.dto";
import { TripService } from "../trips/trip.service";
import {
  MissingRouteCostException,
  MissingTripPricingInputException,
  NegativeTotalPriceException,
  TripNotFoundForPricingException,
  TripNotPriceableException,
} from "./exceptions/pricing-engine.exceptions";
import {
  PricingCalculationContext,
  PricingCustomPropertyInput,
  PricingRouteCostInput,
  PricingRouteIdentity,
} from "./pricing-calculation-context";
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
import { PRICING_ENGINE_VERSION } from "./pricing-engine.version";
import { sumLineAmounts } from "./pricing-money";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";
import { RouteCostResolver } from "./route-cost.resolver";

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
    private readonly routeCostResolver: RouteCostResolver,
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
    const totalPrice = sumLineAmounts(lines.map((line) => line.amount));

    // trip_pricing.total_price carries a non-negative CHECK. Refusing here
    // names the pricing concept instead of surfacing a constraint violation.
    // This is a persistence guard, not a pricing rule.
    if (totalPrice.isNegative()) {
      this.logger.warn("Refused a calculation whose total is below zero", {
        tripId,
        lineCount: lines.length,
      });

      throw new NegativeTotalPriceException(tripId);
    }

    this.logger.log("Pricing calculation produced lines", {
      tripId,
      strategy: preparation.context.rules.strategy,
      lineCount: lines.length,
      components: lines.map((line) => line.component),
    });

    return {
      ...preparation,
      lines,
      totalPrice,
      calculatedAt: new Date(),
      pricingEngineVersion: PRICING_ENGINE_VERSION,
      pricingRuleVersion: preparation.context.rules.ruleVersion,
      calculationStatus: PricingCalculationStatus.CALCULATED,
    };
  }

  /**
   * Prices a Trip and stores the result as its snapshot.
   *
   * The Engine's complete operation: prepare, run the steps, total them, then
   * hand the finished result to the persistence boundary. Calculation and
   * persistence stay separate — `calculate` still returns a result without
   * storing it, so a caller can inspect one before deciding to keep it.
   *
   * Storing is atomic, so this either produces a complete snapshot or leaves
   * the previous one untouched. There is no state in between.
   */
  async calculateAndStore(tripId: string): Promise<PricingCalculationResult> {
    return this.store(await this.calculate(tripId));
  }

  /**
   * Ensures a CLOSED Trip has pricing calculated against the current
   * configuration.
   *
   * Two states are legitimate here, and the operation covers both:
   *
   *   CLOSED with a snapshot    -> recalculate and replace it
   *   CLOSED with no snapshot   -> calculate its first snapshot
   *
   * Anything else is rejected, because `calculate` enforces every precondition
   * first: an OPEN, CANCELLED or DELETED Trip never reaches this point, and
   * neither does one whose configuration cannot price it.
   *
   * Accepting the second state is what makes the system recoverable. Automatic
   * pricing runs once, on the OPEN -> CLOSED transition, and CLOSED is
   * terminal — so a Trip whose automatic pricing failed for a configuration
   * reason could never be priced again if this operation insisted a snapshot
   * already existed. Refusing it left the only fix outside the application
   * entirely.
   *
   * "Reprocess" therefore means "make this Trip's pricing current", not "a
   * snapshot must already be there".
   *
   * The existing snapshot is never removed up front. It is replaced inside the
   * write's transaction, so a calculation that fails and a persistence that
   * fails both leave the previous snapshot exactly as it was.
   */
  async reprocess(tripId: string): Promise<PricingCalculationResult> {
    this.logger.log("Pricing reprocess requested", { tripId });

    const result = await this.calculate(tripId);

    // The two states differ only in what the write will do — replace a
    // breakdown, or create the first one — so they are logged apart and then
    // stored by the same code.
    this.logger.log(
      result.isReprocess
        ? "Replacing the Trip's existing pricing snapshot"
        : "Calculating the Trip's first pricing snapshot",
      { tripId, hasExistingSnapshot: result.isReprocess },
    );

    return this.store(result);
  }

  /**
   * Hands a finished result to the persistence boundary.
   *
   * Shared by the two store operations so they cannot diverge in what they
   * write or in what they log.
   */
  private async store(
    result: PricingCalculationResult,
  ): Promise<PricingCalculationResult> {
    await this.snapshotWriter.writeSnapshot(result);

    this.logger.log("Pricing calculation stored", {
      tripId: result.tripId,
      isReprocess: result.isReprocess,
      lineCount: result.lines.length,
      calculationStatus: result.calculationStatus,
    });

    return result;
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
   * inputs — base source, assigned properties, route costs. A failure at any
   * step aborts before the later, more expensive lookups run.
   */
  async prepareCalculation(tripId: string): Promise<PricingPreparation> {
    this.logger.log("Pricing calculation requested", { tripId });

    const startedAtMs = Date.now();

    this.logger.log("Pricing calculation started", { tripId });

    const trip = await this.requirePriceableTrip(tripId);
    const rules = await this.ruleResolver.resolve();

    /*
     * The route is read straight off the Trip and does not depend on the
     * strategy: a Trip runs one route however its base price is derived.
     *
     * A destination is required to have one at all. A manually created Trip
     * may not have been given one yet, and that is refused here — through the
     * same "missing input" report the engine already uses — rather than being
     * carried as a null into calculators that all assume a route exists.
     */
    if (!trip.destinationCity) {
      this.logger.warn("Pricing requested for a Trip with no destination", {
        tripId,
      });

      throw new MissingTripPricingInputException(
        tripId,
        "destinationCity",
        rules.strategy,
      );
    }

    const route: PricingRouteIdentity = {
      departure: trip.terminal,
      destination: trip.destinationCity,
    };

    const baseSource = await this.componentResolver.resolveBaseSource(
      trip,
      rules,
    );
    const assignedCustomProperties =
      await this.componentResolver.resolveAssignedCustomProperties(trip.id);
    const routeCosts = await this.routeCostResolver.resolve(trip.id, route);

    // Both halves of every route-priced component are now known, so the pairing
    // between them can be checked before any step runs.
    this.assertRoutePricedPropertiesArePriced(
      trip.id,
      route,
      assignedCustomProperties,
      routeCosts,
    );

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
      route,
      baseSource,
      rules,
      assignedCustomProperties,
      routeCosts,
      existingSnapshot,
      preparedAt,
    };

    const durationMs = Date.now() - startedAtMs;

    this.logger.log("Pricing calculation finished", {
      tripId,
      strategy: rules.strategy,
      isCombination: context.isCombination,
      isReprocess: existingSnapshot !== null,
      assignedCustomPropertyCount: assignedCustomProperties.length,
      routeCostCount: routeCosts.length,
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
  /**
   * Every route-priced Custom Property the Trip carries must have a matching
   * active RouteCost.
   *
   * A property linked to a Pricing Component declares only that the component
   * APPLIES; its amount lives in the route cost configuration. If the property
   * was assigned but no cost is configured for this route, the component
   * applies and its amount is unknown — a configuration error. Pricing the Trip
   * anyway would either invent a zero charge or drop a real one silently.
   *
   * The check names no component. It is expressed purely as "a linked property
   * must be priced", so it holds for Toll, for Tunnel and for any route-priced
   * component added later, without a calculator having to re-implement it and
   * without a component code appearing in this service.
   *
   * It lives here rather than in a resolver because it spans two resolvers'
   * output: applicability comes from the Trip's assignments, the amount from
   * the route. Pairing them is orchestration, which is this service's job.
   */
  private assertRoutePricedPropertiesArePriced(
    tripId: string,
    route: PricingRouteIdentity,
    assignedCustomProperties: readonly PricingCustomPropertyInput[],
    routeCosts: readonly PricingRouteCostInput[],
  ): void {
    const pricedComponents = new Set(
      routeCosts.map((routeCost) => routeCost.pricingComponentId),
    );

    for (const property of assignedCustomProperties) {
      // A fixed-price property carries its own amount and needs no route cost.
      if (property.pricingComponentId === null) {
        continue;
      }

      if (!pricedComponents.has(property.pricingComponentId)) {
        this.logger.warn("Route-priced custom property has no route cost", {
          tripId,
          customPropertyId: property.customPropertyId,
          pricingComponentId: property.pricingComponentId,
        });

        throw new MissingRouteCostException(
          tripId,
          property.pricingComponentId,
          route.departure,
          route.destination,
        );
      }
    }
  }

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
