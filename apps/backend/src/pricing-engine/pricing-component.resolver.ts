import { Injectable } from "@nestjs/common";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { TripCustomPropertyService } from "../trip-custom-properties/trip-custom-property.service";
import { TripResponseDto } from "../trips/dto/trip-response.dto";
import { TripService } from "../trips/trip.service";
import {
  CombinationLeg,
  CombinationMember,
  combinationLegOf,
} from "./combination-leg";
import {
  InvalidCombinationForPricingException,
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
    private readonly customPropertyService: CustomPropertyService,
    private readonly tripService: TripService,
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
    trip: TripResponseDto,
    rules: PricingRuleConfiguration,
  ): Promise<PricingCustomPropertyInput[]> {
    const { items } = await this.tripCustomPropertyService.findByTripId(trip.id);

    const assigned: PricingCustomPropertyInput[] = items.map((assignment) => ({
      customPropertyId: assignment.customProperty.id,
      name: assignment.customProperty.name,
      pricingComponentId: assignment.customProperty.pricingComponentId,
      defaultPrice: assignment.customProperty.defaultPrice,
    }));

    const resolved = await this.withAutomaticProperty(trip, rules, assigned);

    this.logger.log("Custom properties resolved", {
      tripId: trip.id,
      assignedCount: assigned.length,
      resolvedCount: resolved.length,
    });

    return resolved;
  }

  /**
   * Applies the automatic property — TAR — to the Trips that owe it.
   *
   * ── WHY THE ASSIGNMENTS ARE OVERRULED, NOT TRUSTED ────────────────────────
   * The automatic property is removed from the assignments first and then added
   * back only where the rule says it belongs. Doing it in that order is what
   * makes every starting state produce the same answer:
   *
   *   nobody assigned it            -> it is applied anyway
   *   somebody assigned it          -> it is applied once, not twice
   *   it sits on the wrong leg      -> it moves to the right one
   *   it sits on both legs          -> one charge, on the collection
   *
   * The operator therefore never has to tick it, and a stale tick left over
   * from before this rule existed cannot produce a second charge.
   *
   * Only NEW calculations are affected. A stored snapshot is a record of what
   * was charged and is never rewritten by a rule change; a reprocess is how an
   * administrator asks for the current rules to be applied.
   * ──────────────────────────────────────────────────────────────────────────
   *
   * ── WHICH TRIPS OWE IT ────────────────────────────────────────────────────
   * Every Trip, except the DELIVERY leg of a genuine Combination: the pair is
   * one movement and carries the charge once, on the collection. A manual group
   * is not a Combination, so its Trips each owe it — see `combination-leg.ts`.
   * ──────────────────────────────────────────────────────────────────────────
   */
  private async withAutomaticProperty(
    trip: TripResponseDto,
    rules: PricingRuleConfiguration,
    assigned: readonly PricingCustomPropertyInput[],
  ): Promise<PricingCustomPropertyInput[]> {
    const withoutIt = assigned.filter(
      (property) =>
        property.customPropertyId !== rules.automaticCustomPropertyId,
    );

    const leg = await this.resolveCombinationLeg(trip);

    if (leg === CombinationLeg.INVALID) {
      this.logger.warn("Pricing refused a malformed Combination", {
        tripId: trip.id,
        tripGroupId: trip.tripGroupId,
      });

      throw new InvalidCombinationForPricingException(
        trip.id,
        trip.tripGroupId as string,
        await this.directionsOfGroup(trip),
      );
    }

    if (leg === CombinationLeg.DELIVERY) {
      return withoutIt;
    }

    return [...withoutIt, await this.automaticProperty(rules)];
  }

  /** The configured automatic property, as the calculator reads any other. */
  private async automaticProperty(
    rules: PricingRuleConfiguration,
  ): Promise<PricingCustomPropertyInput> {
    const property = await this.customPropertyService.findById(
      rules.automaticCustomPropertyId,
    );

    return {
      customPropertyId: property.id,
      name: property.name,
      pricingComponentId: property.pricingComponentId,
      // The configured price, whatever it currently is. Never a literal.
      defaultPrice: property.defaultPrice,
    };
  }

  /**
   * Which leg of a genuine Combination this Trip is.
   *
   * The group is read only when the Trip is in one, so an ordinary Trip costs
   * no extra query.
   */
  private async resolveCombinationLeg(
    trip: TripResponseDto,
  ): Promise<CombinationLeg> {
    if (trip.tripGroupId === null || trip.pdfDocumentId === null) {
      return CombinationLeg.NONE;
    }

    return combinationLegOf(trip, await this.groupMembers(trip));
  }

  private async groupMembers(
    trip: TripResponseDto,
  ): Promise<CombinationMember[]> {
    const { items } = await this.tripService.findByGroupId(
      trip.tripGroupId as string,
    );

    return items;
  }

  /** For the refusal message, so the fault can be seen without a query. */
  private async directionsOfGroup(
    trip: TripResponseDto,
  ): Promise<(string | null)[]> {
    const members = await this.groupMembers(trip);

    return members
      .filter((member) => member.pdfDocumentId === trip.pdfDocumentId)
      .map((member) => member.direction);
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
