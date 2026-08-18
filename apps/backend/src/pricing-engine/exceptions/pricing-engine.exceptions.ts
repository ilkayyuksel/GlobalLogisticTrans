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
  MISSING_ROUTE_COST: "PRICING_MISSING_ROUTE_COST",
  MISSING_CUSTOM_PROPERTY_PRICE: "PRICING_MISSING_CUSTOM_PROPERTY_PRICE",
  NEGATIVE_TOTAL: "PRICING_NEGATIVE_TOTAL",
  UNKNOWN_PRICING_COMPONENT: "PRICING_UNKNOWN_COMPONENT",
  INVALID_COMBINATION: "PRICING_INVALID_COMBINATION",
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
 * A Trip carries a route-priced Custom Property whose route cost is not
 * configured.
 *
 * This is a configuration error, not a Trip that owes nothing. The property was
 * assigned deliberately, so the component DOES apply; the amount is simply
 * missing. Pricing the Trip anyway would either invent a zero charge or drop a
 * real one silently, and both produce an invoice that is quietly wrong.
 *
 * The component is named by code rather than by id so the message tells an
 * administrator what to configure. The property's name is not included: it is
 * commercial configuration, and the component code identifies the gap.
 */
export class MissingRouteCostException extends PricingEngineException {
  constructor(
    readonly tripId: string,
    readonly pricingComponentId: string,
    readonly departure: string | null,
    readonly destination: string,
  ) {
    super(
      PricingEngineErrorCode.MISSING_ROUTE_COST,
      `Trip "${tripId}" carries a route-priced custom property for pricing component "${pricingComponentId}", but no active route cost is configured for "${departure ?? "(no terminal)"}" to "${destination}".`,
    );
  }
}

/**
 * A Trip carries a fixed-price Custom Property that has no configured price.
 *
 * A property with no Pricing Component link is priced by its own default price,
 * so a null there leaves the charge unknown. That is a configuration error, not
 * a property that costs nothing: pricing it at zero would silently drop a real
 * charge, and skipping it would silently drop the whole line.
 *
 * The property is named by id. Its name and price are commercial configuration
 * and never appear in a message that reaches the log.
 */
export class MissingCustomPropertyPriceException extends PricingEngineException {
  constructor(
    readonly tripId: string,
    readonly customPropertyId: string,
  ) {
    super(
      PricingEngineErrorCode.MISSING_CUSTOM_PROPERTY_PRICE,
      `Trip "${tripId}" carries custom property "${customPropertyId}", which has no default price configured. A fixed-price custom property must define one before the Trip can be priced.`,
    );
  }
}

/**
 * The calculated total came out below zero.
 *
 * `trip_pricing.total_price` carries a non-negative CHECK, so this would fail
 * at the database anyway. It is refused here instead, before the transaction
 * opens, so the failure names the pricing concept rather than surfacing as a
 * constraint violation nobody can act on.
 *
 * This is a persistence guard, not a pricing rule: nothing here decides what a
 * component is worth, and no amount is named in the message.
 */
export class NegativeTotalPriceException extends PricingEngineException {
  constructor(readonly tripId: string) {
    super(
      PricingEngineErrorCode.NEGATIVE_TOTAL,
      `The pricing calculated for Trip "${tripId}" totals less than zero, which cannot be stored. Review the configured amounts that produced it.`,
    );
  }
}

/**
 * A calculated line names a component the catalog does not hold.
 *
 * Every item carries a foreign key to `pricing_component`, so a code with no
 * catalog row cannot be persisted. Refused before the transaction opens rather
 * than left to the foreign key, which would report a column and an id instead
 * of the component that is actually missing.
 */
export class UnknownPricingComponentException extends PricingEngineException {
  constructor(readonly componentCode: string) {
    super(
      PricingEngineErrorCode.UNKNOWN_PRICING_COMPONENT,
      `Pricing component "${componentCode}" is not present in the catalog, so the calculated line cannot be stored.`,
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

/**
 * The Trips of one transport order are grouped, but they are not one delivery
 * and one collection.
 *
 * No real order produces this, so it is a configuration or data fault rather
 * than a priceable state. Pricing stops instead of guessing which leg should
 * carry the charges a Combination places on exactly one of them.
 */
export class InvalidCombinationForPricingException extends PricingEngineException {
  constructor(
    readonly tripId: string,
    readonly tripGroupId: string,
    readonly directions: readonly (string | null)[],
  ) {
    super(
      PricingEngineErrorCode.INVALID_COMBINATION,
      `Trip ${tripId} belongs to group ${tripGroupId}, whose Trips came from one transport order but do not form one DELIVERY and one COLLECTION (found: ${directions
        .map((direction) => direction ?? "none")
        .join(", ")}). Correct the group before pricing it.`,
    );
  }
}
