import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { TripCustomPropertyService } from "../trip-custom-properties/trip-custom-property.service";
import { TripResponseDto } from "../trips/dto/trip-response.dto";
import {
  MissingRoutePricingException,
  MissingTripPricingInputException,
} from "./exceptions/pricing-engine.exceptions";
import {
  PricingBaseSource,
  PricingCustomPropertyInput,
  PricingRuleConfiguration,
} from "./pricing-calculation-context";
import { PricingStrategy } from "./pricing-settings";
import { PricingRuleResolver } from "./pricing-rule.resolver";

/**
 * Resolves the pricing inputs a specific Trip will be priced against.
 *
 * Where PricingRuleResolver answers "what are the rules", this resolver answers
 * "what does THIS Trip price against": which base-price source the active
 * strategy selects, and which Custom Properties the Trip actually carries.
 *
 * It resolves inputs; it never combines them. No rate is multiplied by a
 * distance and no percentage is applied here — that is the calculation phase,
 * and keeping the two apart is what makes the resolved inputs reusable and the
 * formulas testable in isolation.
 */
@Injectable()
export class PricingComponentResolver {
  constructor(
    private readonly routePricingService: RoutePricingService,
    private readonly tripCustomPropertyService: TripCustomPropertyService,
    private readonly ruleResolver: PricingRuleResolver,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PricingComponentResolver.name);
  }

  /**
   * Selects the base-price source dictated by the active strategy.
   *
   * Each strategy needs a different Trip input, so a Trip that is priceable
   * under one may be unpriceable under the other. That is reported as a
   * validation failure naming the missing input rather than silently producing
   * a base price of zero.
   */
  async resolveBaseSource(
    trip: TripResponseDto,
    rules: PricingRuleConfiguration,
  ): Promise<PricingBaseSource> {
    if (rules.strategy === PricingStrategy.ROUTE_BASED) {
      return this.resolveRouteBaseSource(trip);
    }

    return this.resolveDistanceBaseSource(trip);
  }

  /**
   * The Custom Properties this Trip carries.
   *
   * The Trip's assignments, not the catalog. Reading the catalog would have
   * charged every Trip for every configured property; a property contributes
   * only because someone assigned it.
   *
   * Deactivated properties are kept. The assignment is a fact about this Trip,
   * and withdrawing a property from the catalog must not silently change what
   * an already-planned Trip is charged — TripCustomPropertyService blocks new
   * assignments of an inactive property, which is where that rule belongs.
   *
   * Everything a later calculator needs travels on the returned rows, so no
   * calculator has to reach back into a service: the component link tells it
   * whether the property is fixed-price or route-priced, and the default price
   * is the amount for the fixed-price case.
   */
  async resolveAssignedCustomProperties(
    tripId: string,
  ): Promise<PricingCustomPropertyInput[]> {
    const { items } = await this.tripCustomPropertyService.findByTripId(tripId);

    this.logger.log("Assigned custom properties resolved", {
      tripId,
      assignedCount: items.length,
    });

    return items.map((assignment) => ({
      customPropertyId: assignment.customProperty.id,
      name: assignment.customProperty.name,
      pricingComponentId: assignment.customProperty.pricingComponentId,
      defaultPrice: assignment.customProperty.defaultPrice,
    }));
  }

  /**
   * Route-Based Pricing: the base price is the configured price of the
   * terminal-to-destination route.
   */
  private async resolveRouteBaseSource(
    trip: TripResponseDto,
  ): Promise<PricingBaseSource> {
    if (!trip.terminal) {
      this.rejectMissingInput(trip.id, "terminal", PricingStrategy.ROUTE_BASED);
    }

    // A route has two ends. A Trip created by hand may not have been given a
    // destination yet, and half a route matches nothing.
    if (!trip.destinationCity) {
      this.rejectMissingInput(
        trip.id,
        "destinationCity",
        PricingStrategy.ROUTE_BASED,
      );
    }

    const routePricing = await this.routePricingService.findActiveRoute(
      trip.terminal,
      trip.destinationCity,
    );

    if (!routePricing) {
      this.logger.warn("No active route pricing for the Trip's route", {
        tripId: trip.id,
      });

      throw new MissingRoutePricingException(
        trip.terminal,
        trip.destinationCity,
      );
    }

    // The route itself is not repeated here: the lookup above matched departure
    // and destination exactly, so the configured row's route is the Trip's
    // route, and the context already carries it.
    return {
      strategy: PricingStrategy.ROUTE_BASED,
      routePricingId: routePricing.id,
      basePrice: routePricing.basePrice,
    };
  }

  /**
   * Distance-Based Pricing: the base price is derived from the Trip's manually
   * entered distance and the configured rate. Both are resolved here; the
   * multiplication belongs to the calculation phase.
   */
  private async resolveDistanceBaseSource(
    trip: TripResponseDto,
  ): Promise<PricingBaseSource> {
    if (trip.distanceKm === null) {
      this.rejectMissingInput(
        trip.id,
        "distance",
        PricingStrategy.DISTANCE_BASED,
      );
    }

    return {
      strategy: PricingStrategy.DISTANCE_BASED,
      distanceKm: trip.distanceKm,
      ratePerKm: await this.ruleResolver.resolveDistanceRatePerKm(),
    };
  }

  private rejectMissingInput(
    tripId: string,
    missingInput: string,
    strategy: PricingStrategy,
  ): never {
    this.logger.warn("Trip is missing an input the active strategy requires", {
      tripId,
      missingInput,
      strategy,
    });

    throw new MissingTripPricingInputException(tripId, missingInput, strategy);
  }
}
