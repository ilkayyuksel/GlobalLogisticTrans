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
  readonly waitingTimeBlockMinutes: number;
}

/**
 * Where the base price comes from, discriminated by the active strategy.
 *
 * A union rather than a bag of nullable fields: it makes the two strategies
 * mutually exclusive at the type level, so a calculation step cannot read a
 * distance rate on a route-based calculation even by mistake.
 */
export type PricingBaseSource =
  | {
      readonly strategy: typeof PricingStrategy.ROUTE_BASED;
      readonly routePricingId: string;
      readonly departure: string;
      readonly destination: string;
      readonly basePrice: string;
    }
  | {
      readonly strategy: typeof PricingStrategy.DISTANCE_BASED;
      readonly distanceKm: string;
      readonly ratePerKm: string;
    };

/** A configured Custom Property, with the price it would contribute. */
export interface PricingCustomPropertyInput {
  readonly customPropertyId: string;
  readonly name: string;
  readonly defaultPrice: string | null;
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

  readonly baseSource: PricingBaseSource;
  readonly rules: PricingRuleConfiguration;

  /**
   * The active Custom Property catalog with its configured prices.
   *
   * NOT the properties assigned to this Trip. That link lives in
   * `trip_custom_property`, which no service exposes yet, so the Custom
   * Property calculation phase cannot run on this context alone — see the
   * Engine's documentation.
   */
  readonly activeCustomProperties: readonly PricingCustomPropertyInput[];

  readonly existingSnapshot: ExistingPricingSnapshot | null;
  readonly preparedAt: Date;
}
