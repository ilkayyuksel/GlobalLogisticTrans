import { Injectable } from "@nestjs/common";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { RouteConfigurationKind } from "../route-pricing/route-pricing.repository";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { TripCustomPropertyReadService } from "../trip-custom-properties/trip-custom-property-read.service";
import { meaningfulTarNummer } from "../trips/tar-nummer";
import { toUtcDate } from "../common/dates";
import { TarChargeReadRepository } from "./tar-charge-read.repository";
import { TripReadService, TripReadView } from "../trips/trip-read.service";
import { CombinationLeg, combinationLegOf } from "./combination-leg";
import { MissingTripPricingInputException } from "./exceptions/pricing-engine.exceptions";
import {
  PricingBaseSource,
  PricingCustomPropertyInput,
  PricingOverStInput,
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

/**
 * The route configuration a Trip was matched against.
 *
 * ── WHY ONE MATCH SERVES THREE COMPONENTS ───────────────────────────────────
 * The Tarief, the road's length and the road's tunnel all come from the SAME
 * configured row, and until now each was looked up separately — which was
 * harmless while one road had one configuration. It stopped being harmless when a
 * Combination leg and an ordinary route could describe the same road: two
 * lookups could then match two different rows, and a Trip would be priced with
 * one row's Tarief and another row's tunnel or toll.
 *
 * So the row is matched ONCE and its identity travels with the values taken from
 * it.
 */
export interface MatchedRouteConfiguration {
  readonly routePricingId: string;
  readonly basePrice: string;
  /** Which of the two configurations of this road was matched. */
  readonly kind: RouteConfigurationKind;
  /** The Over ST this Trip owes on top, or null — see `combination-over-st.ts`. */
  readonly overSt: PricingOverStInput | null;
}
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { legFor, overStOwed, partnerOf, roadOf } from "./combination-over-st";

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
    private readonly combinationPricing: CombinationRoutePricingService,
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
  /**
   * The base price this Trip prices against.
   *
   * `matchedRoute` is the configuration the caller already matched for this
   * Trip — passed in rather than looked up again, so the Tarief, the toll and
   * the tunnel cannot come from different rows. Route-Based pricing reads it;
   * Distance-Based pricing ignores it, because a Trip priced by distance prices
   * against its own kilometres and the configured rate.
   */
  async resolveBaseSource(
    trip: TripReadView,
    rules: PricingRuleConfiguration,
    matchedRoute: MatchedRouteConfiguration | null,
  ): Promise<PricingBaseSource> {
    if (rules.strategy === PricingStrategy.ROUTE_BASED) {
      return this.resolveRouteBaseSource(trip, matchedRoute);
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

    /*
     * ── A MALFORMED PAIR IS PRICED, NOT REFUSED ─────────────────────────────
     * The Trips of one document are grouped and yet are not one delivery and
     * one collection. This used to abort the whole calculation, and since the
     * Backload became a matter of plain group membership that cost such a Trip
     * its €50 as well as its TAR — a charge that was never in doubt, because
     * the Trip is in a group whatever shape the group has.
     *
     * So the fault is reported and the Trip is priced: not being a genuine
     * pair, it owes TAR exactly as a member of a manual group does — its own
     * stated number, with the same-day rule still preventing one number from
     * being charged twice.
     */
    if (leg === CombinationLeg.INVALID) {
      this.logger.warn("A group from one document is not one delivery and one collection", {
        tripId: trip.id,
        tripGroupId: trip.tripGroupId,
      });
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
   * The route configuration this Trip prices against, or null when it has none.
   *
   * ── WHICH OF THE TWO CONFIGURATIONS OF A ROAD ─────────────────────────────
   * A road may be configured twice: once as an ordinary route and once as a leg
   * of a Combination, priced differently because a Combination's outbound and
   * return are their own transports. The existing domain rule decides which one
   * applies, and no new rule is invented here: `combinationLegOf` already
   * answers whether a Trip is a leg of a GENUINE Combination — one document that
   * printed an outbound delivery and a return collection — and it is the same
   * answer the TAR allocation uses.
   *
   *   DELIVERY or COLLECTION  a genuine Combination leg: the Combination
   *                           configuration of its road, if one exists.
   *   NONE                    an ordinary Trip, or a group an operator made by
   *                           hand: the ordinary configuration.
   *   INVALID                 the Trips of one document are grouped but are not
   *                           one delivery and one collection. Reported
   *                           elsewhere and never priced on a guess, so it takes
   *                           the ordinary configuration rather than a
   *                           Combination one.
   *
   * ── AND WHY A LEG FALLS BACK ──────────────────────────────────────────────
   * A genuine Combination leg whose road has no Combination configuration takes
   * the ORDINARY one. Every Combination Trip priced before Combination routes
   * existed was priced exactly that way, and refusing to match would silently
   * reprice all of them to zero. The fallback is therefore what keeps existing
   * pricing unchanged; configuring a Combination route is what changes it.
   *
   * Null whenever nobody has said: no terminal, no destination, or no
   * configuration for the road in either context. None of those is an error —
   * see `resolveRouteBaseSource`.
   */
  async resolveConfiguredRoute(
    trip: TripReadView,
  ): Promise<MatchedRouteConfiguration | null> {
    /*
     * A route needs two ends. A Trip missing either cannot MATCH a
     * configuration, which is the same situation as a road nobody has
     * configured — so it takes the same answer rather than a different one.
     */
    if (!trip.terminal || !trip.destinationCity) {
      return null;
    }

    if (await this.isGenuineCombinationLeg(trip)) {
      const paired = await this.matchCombinationPair(trip);

      if (paired) {
        return paired;
      }

      /*
       * The pair is not configured as a Combination: fall back to the road, as
       * before. A match by road alone cannot name the Combination, so it owes
       * no Over ST.
       */
      const leg = await this.routePricingService.findConfiguredRoute(
        trip.terminal,
        trip.destinationCity,
        RouteConfigurationKind.COMBINATION,
      );

      if (leg) {
        return this.toMatch(leg, RouteConfigurationKind.COMBINATION);
      }

      this.logger.log(
        "No Combination route configured for this leg; using the ordinary route",
        { tripId: trip.id },
      );
    }

    const ordinary = await this.routePricingService.findConfiguredRoute(
      trip.terminal,
      trip.destinationCity,
      RouteConfigurationKind.NORMAL,
    );

    return ordinary
      ? this.toMatch(ordinary, RouteConfigurationKind.NORMAL)
      : null;
  }

  /**
   * The Combination configured for this Trip's PAIR of roads, and the leg of it
   * this Trip is — or null when the pair is not configured.
   *
   * ── WHY THE PAIR ──────────────────────────────────────────────────────────
   * One road may be a leg of many Combinations, each with its own prices and its
   * own Over ST, and a lookup by road can only take the first. The two Trips of a
   * genuine Combination name their pair, so the configuration is found by both
   * roads — the identity `isSameCombination` already enforces — and Tarief,
   * Toll, Tunnel and Over ST all come from that one configuration.
   */
  private async matchCombinationPair(
    trip: TripReadView,
  ): Promise<MatchedRouteConfiguration | null> {
    const pair = await this.findCombinationPair(trip);
    const leg = pair ? legFor(pair.ownRoad, pair.combination.legs) : null;

    if (!pair || !leg) {
      return null;
    }

    const overSt = overStOwed(
      leg.combinationLegPosition,
      trip,
      pair.partner,
      pair.combination.overSt,
    );

    this.logger.log("Combination matched by its pair of roads", {
      tripId: trip.id,
      combinationGroupId: pair.combination.id,
      legPosition: leg.combinationLegPosition,
      // Whether Over ST applies, never its amounts.
      overStApplies: overSt !== null,
    });

    return { ...this.toMatch(leg, RouteConfigurationKind.COMBINATION), overSt };
  }

  /**
   * The Trips whose pricing reads the planningDate of this Trip's Combination.
   *
   * ── WHY A DATE CHANGE REACHES ANOTHER TRIP ────────────────────────────────
   * Over ST is owed by LEG 2 when its planningDate differs from LEG 1's, so a
   * change to EITHER leg's date can switch it on or off — and always on Leg 2.
   * So the answer is the leg of this Trip's genuine pair that the configured
   * Combination holds at position 2: this Trip itself, its partner, or neither.
   *
   * Found exactly as pricing finds it — by the PAIR of roads and the genuine
   * Combination rule — so the Trips named are the Trips whose price would move.
   * Nothing for an ordinary Trip, a manual group or an unconfigured pair: their
   * pricing does not read planningDate through this rule.
   */
  async legsPricedByPlanningDate(trip: TripReadView): Promise<string[]> {
    if (!(await this.isGenuineCombinationLeg(trip))) {
      return [];
    }

    const pair = await this.findCombinationPair(trip);

    if (!pair) {
      return [];
    }

    return [trip, pair.partner]
      .filter((member) => {
        const road = roadOf(member);
        const leg = road ? legFor(road, pair.combination.legs) : null;

        return leg?.combinationLegPosition === 2;
      })
      .map((member) => member.id);
  }

  /**
   * This Trip's partner and the Combination configured for their two roads.
   *
   * One lookup for both questions — which configuration prices a leg, and
   * which leg reads the planning dates — so the two can never disagree.
   */
  private async findCombinationPair(trip: TripReadView) {
    const partner = partnerOf(trip, await this.groupMembers(trip));
    const ownRoad = roadOf(trip);
    const partnerRoad = partner ? roadOf(partner) : null;

    if (!partner || !ownRoad || !partnerRoad) {
      return null;
    }

    const combination = await this.combinationPricing.findConfiguredCombination([
      ownRoad,
      partnerRoad,
    ]);

    return combination ? { combination, partner, ownRoad } : null;
  }

  /**
   * Whether this Trip is a leg of a genuine Combination.
   *
   * The same question `resolveCombinationLeg` answers, asked for a different
   * purpose — which route configuration applies, rather than which leg owes the
   * TAR — and deliberately answered by the same rule. A Trip in no group returns
   * without a query at all, so only a grouped Trip reads its group.
   */
  private async isGenuineCombinationLeg(trip: TripReadView): Promise<boolean> {
    const leg = await this.resolveCombinationLeg(trip);

    return leg === CombinationLeg.DELIVERY || leg === CombinationLeg.COLLECTION;
  }

  private toMatch(
    route: { id: string; basePrice: string },
    kind: RouteConfigurationKind,
  ): MatchedRouteConfiguration {
    return {
      routePricingId: route.id,
      basePrice: route.basePrice,
      kind,
      overSt: null,
    };
  }

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

  /** The Trips of this Trip's group, as the read side sees them. */
  private groupMembers(trip: TripReadView): Promise<TripReadView[]> {
    return this.trips.findByGroupId(trip.tripGroupId as string);
  }

  /**
   * Route-Based Pricing: the base price is the configured price of the
   * terminal-to-destination route.
   */
  private async resolveRouteBaseSource(
    trip: TripReadView,
    matchedRoute: MatchedRouteConfiguration | null,
  ): Promise<PricingBaseSource> {
    /*
     * ── AN UNCONFIGURED ROUTE IS NOT A FAILURE ──────────────────────────────
     * It used to raise MissingRoutePricingException, which meant no snapshot was
     * written at all — and that had consequences far beyond the base price. A
     * CLOSED Trip on an unconfigured route showed nothing in any of the eight
     * pricing columns, offered no way to correct the Tarief by hand, and could
     * not carry a waiting time, a custom property or a cost confirmation,
     * because every one of those reads the snapshot that was never created.
     *
     * On this business's data that was the ORDINARY case rather than an edge
     * one: most real routes have no configured price. So the absence of a
     * configuration is now what it always was in fact — a price of zero that an
     * operator can correct — and the Trip receives a complete snapshot that the
     * dynamic components can move.
     *
     * Nothing is invented. Zero is not a guess at what the route costs; it is
     * the honest statement that nobody has said what it costs, and it is visibly
     * zero on screen rather than silently absent. A Trip with half a route
     * reaches here the same way, having matched nothing.
     * ────────────────────────────────────────────────────────────────────────
     */
    if (!matchedRoute) {
      this.logger.warn("No route pricing matched; the Trip prices at zero", {
        tripId: trip.id,
        hasTerminal: Boolean(trip.terminal),
        hasDestination: Boolean(trip.destinationCity),
      });

      return UNCONFIGURED_ROUTE_BASE;
    }

    // The route itself is not repeated here: the match was made on this Trip's
    // departure and destination, and the context already carries them.
    return {
      strategy: PricingStrategy.ROUTE_BASED,
      routePricingId: matchedRoute.routePricingId,
      basePrice: matchedRoute.basePrice,
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
