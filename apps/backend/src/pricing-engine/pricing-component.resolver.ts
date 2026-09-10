import { Injectable } from "@nestjs/common";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { TripCustomPropertyReadService } from "../trip-custom-properties/trip-custom-property-read.service";
import { meaningfulTarNummer } from "../trips/tar-nummer";
import { toUtcDate } from "../common/dates";
import { TarChargeReadRepository } from "./tar-charge-read.repository";
import { TripReadService, TripReadView } from "../trips/trip-read.service";
import {
  CombinationLeg,
  CombinationMember,
  combinationLegOf,
} from "./combination-leg";
import {
  InvalidCombinationForPricingException,
  MissingTripPricingInputException,
} from "./exceptions/pricing-engine.exceptions";
import {
  PricingBaseSource,
  PricingCustomPropertyInput,
  PricingRuleConfiguration,
} from "./pricing-calculation-context";
import { PricingStrategy } from "./pricing-settings";

/**
 * What a Trip is priced at when its route has no configuration.
 *
 * A real zero rather than an absent value: the Base Price line is still
 * written, the Fuel Surcharge is still calculated from it (and comes out at
 * zero), and the operator can override the Tarief afterwards.
 */
const UNCONFIGURED_ROUTE_BASE = {
  strategy: PricingStrategy.ROUTE_BASED,
  routePricingId: null,
  basePrice: "0.00",
} as const;
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
    private readonly tripCustomProperties: TripCustomPropertyReadService,
    private readonly customPropertyService: CustomPropertyService,
    private readonly trips: TripReadService,
    private readonly ruleResolver: PricingRuleResolver,
    private readonly tarCharges: TarChargeReadRepository,
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
    trip: TripReadView,
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
    trip: TripReadView,
    rules: PricingRuleConfiguration,
  ): Promise<PricingCustomPropertyInput[]> {
    /*
     * Through the READ side: the write service resolves the Trip again for its
     * own 404 and returns the container-type rule the Engine has no use for,
     * and it depends on the Engine now that assigning recalculates. See
     * TripCustomPropertyReadService.
     */
    const assigned: PricingCustomPropertyInput[] =
      await this.tripCustomProperties.findByTripId(trip.id);

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
   * ── THE AUTOMATIC CHARGE IS ADDED BESIDE THE ASSIGNMENTS ──────────────────
   * It used to REPLACE any assignment of the same property, so that a tick
   * could never produce a second charge. That is reversed: a manual TAR is an
   * EXTRA the business wants, and the two are now independent amounts for
   * independent reasons.
   *
   *   nobody assigned it            -> the automatic charge applies, once
   *   an operator assigned it       -> BOTH apply: automatic + manual
   *   no `tar_nummer` but assigned  -> the manual charge alone
   *   the same-day rule withheld it -> the manual charge alone
   *
   * The operator still never has to tick it to get the automatic one, and this
   * step still decides the automatic charge alone — assigning TAR by hand
   * changes nothing about whether the Trip owes the automatic one.
   *
   * Only NEW calculations are affected. A stored snapshot is a record of what
   * was charged and is never rewritten by a rule change; a reprocess is how an
   * administrator asks for the current rules to be applied.
   * ──────────────────────────────────────────────────────────────────────────
   *
   * ── WHICH TRIPS OWE IT ────────────────────────────────────────────────────
   * Every Trip, except the COLLECTION leg of a genuine Combination: the pair is
   * one movement and carries the charge once, on the delivery. A manual group
   * is not a Combination, so its Trips each owe it — see `combination-leg.ts`.
   * ──────────────────────────────────────────────────────────────────────────
   */
  private async withAutomaticProperty(
    trip: TripReadView,
    rules: PricingRuleConfiguration,
    assigned: readonly PricingCustomPropertyInput[],
  ): Promise<PricingCustomPropertyInput[]> {
    /*
     * ── A MANUAL TAR IS KEPT, NOT STRIPPED ────────────────────────────────
     * This used to remove every assignment of the automatic property before
     * deciding, so a stale tick could not produce a second charge. The business
     * now WANTS that second charge: an operator may assign TAR deliberately as
     * an EXTRA, on top of whatever the Engine applies from the `tar_nummer`.
     *
     * So the assignments pass through untouched and the automatic line is added
     * BESIDE them. A Trip carrying both ends up with two contributions of the
     * configured amount, which is the point — €20 automatic plus €20 manual is
     * €40, and neither suppresses the other.
     */
    const manual = [...assigned];

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

    if (leg === CombinationLeg.COLLECTION) {
      return manual;
    }

    /*
     * ── THE TRIP MUST STATE A TAR-NUMMER ────────────────────────────────────
     * The charge used to follow from the Trip existing: every Trip owed it
     * except a Combination's collection leg. It now follows from the operator
     * having written the number down, because that number is what the charge
     * refers to — charging for a TAR nobody recorded produced a line no invoice
     * could be checked against.
     *
     * `hasTarNummer` is the single definition of "stated", shared with the DTO
     * that stores it and the WhatsApp caption that prints it. Whitespace is
     * absence.
     *
     * It reads THIS Trip's own column and nothing else. A TAR-nummer is not
     * shared across a group, a Combination or a container — each Trip states
     * its own — so a number on the delivery leg says nothing about the
     * collection leg, and never did anything to it.
     *
     * The ALLOCATION rule above is untouched: which leg owes it, and that a
     * genuine Combination owes it at most once, are decided exactly as before.
     * This only decides whether there is anything to allocate. So a Combination
     * whose delivery leg states a number still produces exactly one charge, on
     * the same leg as always — and one whose delivery leg states none produces
     * no TAR charge at all, however the collection leg is filled in.
     */
    const tarNummer = meaningfulTarNummer(trip.tarNummer);

    if (tarNummer === null) {
      return manual;
    }

    /*
     * ── ONE TAR NUMBER IS CHARGED ONCE A DAY ────────────────────────────────
     * The number is not globally unique — it is unique for CHARGING purposes
     * within its operational day. Several Trips legitimately carry the same
     * one, and the charge belongs to the first of them that was actually
     * priced; the rest state the number without paying for it again.
     *
     * "Already charged" is a CHARGE, never the mere presence of the string:
     * see `TarChargeReadRepository`, which looks for a pricing item naming the
     * automatic property. A number typed on a Trip nobody ever closed has been
     * charged to nobody and must not block a real one.
     *
     * The day is `planningDate` — the operational day the Ritten views group
     * by. `originalPlanningDate` is deliberately not used: the schema keeps it
     * as the immutable IMPORT date, so a Trip an operator moved to another day
     * would still be judged against the day it arrived for.
     *
     * A Trip with no planning date is not on any day, so there is nothing to
     * compare it against and the charge applies as it always did.
     */
    if (trip.planningDate !== null) {
      const alreadyCharged = await this.tarCharges.hasBeenChargedToday({
        tripId: trip.id,
        planningDate: toUtcDate(trip.planningDate),
        tarNummer,
        automaticCustomPropertyId: rules.automaticCustomPropertyId,
      });

      if (alreadyCharged) {
        this.logger.log("TAR already charged on this day; not charged again", {
          tripId: trip.id,
          planningDate: trip.planningDate,
          // The NUMBER is business data and is never logged.
        });

        return manual;
      }
    }

    return [...manual, await this.automaticProperty(rules)];
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
  /**
   * Which leg of a genuine Combination this Trip is, or NONE.
   *
   * Public because the Combination Surcharge needs the same answer the TAR rule
   * needs, and both must come from ONE rule. Eligibility for that surcharge is
   * NOT "has a group": a manual group carries no claim about pairing. See
   * `combinationLegOf`.
   */
  async resolveCombinationLeg(
    trip: TripReadView,
  ): Promise<CombinationLeg> {
    if (trip.tripGroupId === null || trip.pdfDocumentId === null) {
      return CombinationLeg.NONE;
    }

    return combinationLegOf(trip, await this.groupMembers(trip));
  }

  private groupMembers(trip: TripReadView): Promise<CombinationMember[]> {
    return this.trips.findByGroupId(trip.tripGroupId as string);
  }

  /** For the refusal message, so the fault can be seen without a query. */
  private async directionsOfGroup(
    trip: TripReadView,
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
    trip: TripReadView,
  ): Promise<PricingBaseSource> {
    /*
     * A route needs two ends. A Trip missing either cannot MATCH a
     * configuration, which is the same situation as a route nobody has
     * configured — so it takes the same answer rather than a different one.
     */
    if (!trip.terminal || !trip.destinationCity) {
      this.logger.warn("Trip has no complete route, so it prices at zero", {
        tripId: trip.id,
        hasTerminal: Boolean(trip.terminal),
        hasDestination: Boolean(trip.destinationCity),
      });

      return UNCONFIGURED_ROUTE_BASE;
    }

    const routePricing = await this.routePricingService.findActiveRoute(
      trip.terminal,
      trip.destinationCity,
    );

    /*
     * ── AN UNCONFIGURED ROUTE IS NOT A FAILURE ──────────────────────────────
     * It used to raise MissingRoutePricingException, which meant no snapshot
     * was written at all — and that had consequences far beyond the base
     * price. A CLOSED Trip on an unconfigured route showed nothing in any of
     * the eight pricing columns, offered no way to correct the Tarief by hand,
     * and could not carry a waiting time, a custom property or a cost
     * confirmation, because every one of those reads the snapshot that was
     * never created.
     *
     * On this business's data that was the ORDINARY case rather than an edge
     * one: most real routes have no configured price. So the absence of a
     * configuration is now what it always was in fact — a price of zero that
     * an operator can correct — and the Trip receives a complete snapshot that
     * the dynamic components can move.
     *
     * Nothing is invented. Zero is not a guess at what the route costs; it is
     * the honest statement that nobody has said what it costs, and it is
     * visibly zero on screen rather than silently absent.
     * ────────────────────────────────────────────────────────────────────────
     */
    if (!routePricing) {
      this.logger.warn("No active route pricing; the Trip prices at zero", {
        tripId: trip.id,
      });

      return UNCONFIGURED_ROUTE_BASE;
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
    trip: TripReadView,
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
