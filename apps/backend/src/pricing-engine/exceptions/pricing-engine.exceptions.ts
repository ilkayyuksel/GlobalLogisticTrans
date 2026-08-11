import { TripStatus } from "@prisma/client";

/**
 * Domain exceptions for the Pricing Engine.
 *
 * Unlike every other module here, these do NOT extend Nest's HTTP exceptions.
 * The Pricing Engine is a domain service with no REST surface, and giving a
 * domain failure an HTTP status would couple pricing logic to a transport it
 * does not have. Whatever eventually exposes the Engine — a "Reprocess Pricing"
 * endpoint, a queue worker, a scheduled job — owns that mapping.
 *
 * Every exception therefore carries a stable machine-readable `code`, so the
 * future mapping is a lookup table rather than a chain of instanceof checks.
 *
 * No message carries a monetary value: these are written to the log, and
 * pricing is commercial information. Setting KEYS are named, never their values.
 */

export const PricingEngineErrorCode = {
  TRIP_NOT_FOUND: "PRICING_TRIP_NOT_FOUND",
  TRIP_NOT_CLOSED: "PRICING_TRIP_NOT_CLOSED",
  MISSING_SETTING: "PRICING_MISSING_SETTING",
  INVALID_SETTING: "PRICING_INVALID_SETTING",
  UNSUPPORTED_STRATEGY: "PRICING_UNSUPPORTED_STRATEGY",
  MISSING_ROUTE_PRICING: "PRICING_MISSING_ROUTE_PRICING",
  MISSING_TRIP_INPUT: "PRICING_MISSING_TRIP_INPUT",
} as const;

export type PricingEngineErrorCode =
  (typeof PricingEngineErrorCode)[keyof typeof PricingEngineErrorCode];

export abstract class PricingEngineException extends Error {
  protected constructor(
    readonly code: PricingEngineErrorCode,
    message: string,
  ) {
    super(message);
    // Without this the class name is lost through the transpiled prototype
    // chain, and `instanceof` checks in the future mapping layer would fail.
    this.name = new.target.name;
  }
}

export class TripNotFoundForPricingException extends PricingEngineException {
  constructor(readonly tripId: string) {
    super(
      PricingEngineErrorCode.TRIP_NOT_FOUND,
      `Trip "${tripId}" does not exist, so it cannot be priced.`,
    );
  }
}

/**
 * pricing_rules.md: pricing runs when a Trip is finished, or when the
 * Administrator reprocesses a CLOSED Trip. No other state produces pricing.
 */
export class TripNotPriceableException extends PricingEngineException {
  constructor(
    readonly tripId: string,
    readonly status: TripStatus,
    readonly requiredStatus: TripStatus,
  ) {
    super(
      PricingEngineErrorCode.TRIP_NOT_CLOSED,
      `Trip "${tripId}" is ${status}. Pricing is only calculated for a ${requiredStatus} Trip.`,
    );
  }
}

export class MissingPricingSettingException extends PricingEngineException {
  constructor(
    readonly category: string,
    readonly settingKey: string,
  ) {
    super(
      PricingEngineErrorCode.MISSING_SETTING,
      `Pricing setting "${category}.${settingKey}" is missing or inactive. Pricing cannot be calculated until it is configured.`,
    );
  }
}

export class InvalidPricingSettingException extends PricingEngineException {
  constructor(
    readonly category: string,
    readonly settingKey: string,
    readonly expectation: string,
  ) {
    super(
      PricingEngineErrorCode.INVALID_SETTING,
      `Pricing setting "${category}.${settingKey}" is not usable: expected ${expectation}.`,
    );
  }
}

export class UnsupportedPricingStrategyException extends PricingEngineException {
  constructor(
    readonly configuredStrategy: string,
    readonly supportedStrategies: readonly string[],
  ) {
    super(
      PricingEngineErrorCode.UNSUPPORTED_STRATEGY,
      `Pricing strategy "${configuredStrategy}" is not supported. Supported strategies: ${supportedStrategies.join(", ")}.`,
    );
  }
}

export class MissingRoutePricingException extends PricingEngineException {
  constructor(
    readonly departure: string,
    readonly destination: string,
  ) {
    super(
      PricingEngineErrorCode.MISSING_ROUTE_PRICING,
      `No active route pricing is configured for "${departure}" to "${destination}".`,
    );
  }
}

/**
 * A Trip is missing a value the active strategy needs — a terminal for
 * route-based pricing, a distance for distance-based pricing.
 */
export class MissingTripPricingInputException extends PricingEngineException {
  constructor(
    readonly tripId: string,
    readonly missingInput: string,
    readonly strategy: string,
  ) {
    super(
      PricingEngineErrorCode.MISSING_TRIP_INPUT,
      `Trip "${tripId}" has no ${missingInput}, which ${strategy} pricing requires.`,
    );
  }
}
