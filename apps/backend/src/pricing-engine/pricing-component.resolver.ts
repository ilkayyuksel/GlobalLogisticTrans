import { Injectable } from "@nestjs/common";

import { MAX_PAGE_SIZE } from "../common/dto/pagination-query.dto";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
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
 * strategy selects, and which Custom Properties carry a configured price.
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
    private readonly customPropertyService: CustomPropertyService,
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
   * The active Custom Property catalog, with the price each would contribute.
   *
   * This is the CONFIGURATION, not the Trip's assignments. The link from a Trip
   * to its properties lives in `trip_custom_property`, which no service exposes
   * yet, so the Custom Property calculation phase needs one more input than the
   * Engine can currently resolve.
   *
   * Only active properties are returned: an inactive property is withdrawn from
   * use and must not enter a new calculation.
   */
  async resolveActiveCustomProperties(): Promise<PricingCustomPropertyInput[]> {
    const page = await this.customPropertyService.findAll({
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      isActive: true,
    });

    // A catalog larger than one page would be silently truncated, and a missing
    // property means a missing charge. Loud rather than wrong.
    if (page.meta.totalItems > page.items.length) {
      this.logger.warn("Active custom property catalog exceeds one page", {
        loaded: page.items.length,
        totalItems: page.meta.totalItems,
      });
    }

    return page.items.map((property) => ({
      customPropertyId: property.id,
      name: property.name,
      defaultPrice: property.defaultPrice,
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

    return {
      strategy: PricingStrategy.ROUTE_BASED,
      routePricingId: routePricing.id,
      departure: routePricing.departure,
      destination: routePricing.destination,
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
