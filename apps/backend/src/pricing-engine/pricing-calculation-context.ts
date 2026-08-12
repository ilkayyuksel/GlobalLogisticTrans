import { TripStatus } from "@prisma/client";

import { PricingStrategy } from "./pricing-settings";

/**
 * The validated inputs of one pricing calculation.
 *
 * The context is the Engine's contract with its future calculation phases: once
 * it exists, every value a formula needs is present, parsed and known to be
 * usable, so a calculation step never has to re-check configuration or reach
 * back into a service. Building it is the whole job of this foundation.
 *
 * Money and percentages are carried as STRINGS, deliberately. They come out of
 * NUMERIC columns and Settings as exact decimal text, and routing them through
 * a JavaScript float would reintroduce the binary rounding those columns exist
 * to avoid. The calculation phase converts them straight into Decimal. Whole
 * minute counts are exact as numbers and are parsed here.
 *
 * The context is read-only in the strongest sense the language allows: nothing
 * inside it may be mutated, because two calculations of the same Trip must see
 * identical inputs to be reproducible.
 */

/** The configured pricing rules, read from Settings at calculation time. */
export interface PricingRuleConfiguration {
  readonly strategy: PricingStrategy;
  /** Percentage applied to the base price only, never to the other components. */
  readonly fuelPercentage: string;
  readonly combinationSurcharge: string;
  readonly waitingTimeFreeMinutes: number;
  /** Always greater than zero: it is the divisor that produces the block count. */
  readonly waitingTimeBlockMinutes: number;
  readonly waitingTimeBlockPrice: string;
  /**
   * The ruleset version stamped onto the snapshot this calculation produces.
   *
   * Configuration rather than code: an administrator bumps it when the pricing
   * Settings change, so it travels with the rules it describes.
   */
  readonly ruleVersion: string;
}

/**
 * The route a Trip runs, independently of how it is priced.
 *
 * A Trip always has exactly one route. The Pricing Strategy decides only how
 * the Base Price is derived from it, so route identity is a property of the
 * Trip rather than of the strategy — which is why it lives here and not inside
 * PricingBaseSource. A distance-based Trip still runs a route, and its Toll and
 * Tunnel costs still depend on that route.
 *
 * `departure` mirrors `trip.terminal`, which is nullable in the database: an
 * import without a recognised terminal still produces a priceable Trip under
 * Distance-Based Pricing. Route-dependent costs simply cannot be matched for
 * such a Trip, and that is a fact for a calculator to interpret, not an error
 * to raise here.
 */
export interface PricingRouteIdentity {
  readonly departure: string | null;
  readonly destination: string;
}

/**
 * Where the base price comes from, discriminated by the active strategy.
 *
 * A union rather than a bag of nullable fields: it makes the two strategies
 * mutually exclusive at the type level, so a calculation step cannot read a
 * distance rate on a route-based calculation even by mistake.
 *
 * It carries no departure or destination. Those describe the Trip's route, not
 * the source of its base price, and duplicating them here would let the two
 * copies disagree.
 */
export type PricingBaseSource =
  | {
      readonly strategy: typeof PricingStrategy.ROUTE_BASED;
      readonly routePricingId: string;
      readonly basePrice: string;
    }
  | {
      readonly strategy: typeof PricingStrategy.DISTANCE_BASED;
      readonly distanceKm: string;
      readonly ratePerKm: string;
    };

/**
 * A Custom Property this Trip carries, with everything a calculator needs.
 *
 * `pricingComponentId` distinguishes the two kinds. Null means a fixed-price
 * property, whose amount is `defaultPrice`. Set means a route-priced one, which
 * decides only that its component APPLIES to this Trip; the amount comes from
 * the matching entry in `routeCosts`. A route-priced property never carries a
 * price of its own, so `defaultPrice` is null whenever `pricingComponentId` is
 * set — the database enforces it.
 */
export interface PricingCustomPropertyInput {
  readonly customPropertyId: string;
  readonly name: string;
  readonly pricingComponentId: string | null;
  readonly defaultPrice: string | null;
}

/**
 * The configured cost of one route-dependent component on this Trip's route.
 *
 * Resolved for the route alone, with no regard to which components actually
 * apply: deciding that is a calculator's job, and it needs the Trip's assigned
 * properties to do it. A component that applies but has no entry here is a
 * missing configuration, and each calculator decides whether that is fatal.
 */
export interface PricingRouteCostInput {
  readonly routeCostId: string;
  readonly pricingComponentId: string;
  /** e.g. TOLL, TUNNEL. Lets a calculator find its own cost without a lookup. */
  readonly componentCode: string;
  readonly amount: string;
}

/** What a reprocess would replace. Null on a Trip's first calculation. */
export interface ExistingPricingSnapshot {
  readonly tripPricingId: string;
  readonly calculationStatus: string;
  readonly itemCount: number;
}

export interface PricingCalculationContext {
  readonly tripId: string;
  readonly bookingNumber: string;
  readonly tripStatus: TripStatus;
  readonly planningDate: string;

  /** Only a Trip in a TripGroup is eligible for the Combination Surcharge. */
  readonly isCombination: boolean;
  /** Absent waiting time is zero waiting time, not an unknown. */
  readonly waitingTimeMinutes: number;

  /** Always present, whichever strategy priced the Trip. */
  readonly route: PricingRouteIdentity;

  readonly baseSource: PricingBaseSource;
  readonly rules: PricingRuleConfiguration;

  /**
   * The Custom Properties assigned to THIS Trip, in display order.
   *
   * The Trip's assignments, not the catalog: a property that exists but was
   * never assigned contributes nothing, and reading the catalog would have made
   * every property apply to every Trip.
   *
   * A property that has since been deactivated is still returned. The Trip
   * carries it, and withdrawing a property from the catalog must not silently
   * change what an already-planned Trip is charged.
   */
  readonly assignedCustomProperties: readonly PricingCustomPropertyInput[];

  /**
   * Every active RouteCost configured for this Trip's route.
   *
   * Empty when the route has none configured, and empty when the Trip has no
   * terminal to match on. Emptiness is not an error at this stage.
   */
  readonly routeCosts: readonly PricingRouteCostInput[];

  readonly existingSnapshot: ExistingPricingSnapshot | null;
  readonly preparedAt: Date;
}
