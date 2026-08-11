import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for the TripPricingItem module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * No message carries an amount, a quantity or a unit price: an error is written
 * to the log, and pricing is commercial information.
 *
 * There is deliberately no "cannot delete" exception: pricing items are never
 * removed individually, so the module exposes no delete operation at all.
 */

export class TripPricingItemNotFoundException extends NotFoundException {
  constructor(tripPricingItemId: string) {
    super(`Trip pricing item "${tripPricingItemId}" does not exist.`);
  }
}

export class UnknownPricingComponentException extends NotFoundException {
  constructor(pricingComponentId: string) {
    super(`Pricing component "${pricingComponentId}" does not exist.`);
  }
}

/**
 * database_schema.md §8.2: inactive components cannot be used for new
 * calculations, while historical items keep referencing them.
 */
export class InactivePricingComponentException extends ConflictException {
  constructor(pricingComponentId: string) {
    super(
      `Pricing component "${pricingComponentId}" is inactive and cannot classify a new pricing item.`,
    );
  }
}

/**
 * The Reference Entity explains *why* an item exists, and only a Custom
 * Property item has a Custom Property to point at. Allowing any other component
 * to carry one would let the breakdown misstate the origin of an amount.
 */
export class InvalidReferenceEntityException extends ConflictException {
  constructor(componentCode: string, requiredCode: string) {
    super(
      `A custom property reference is only valid on a ${requiredCode} item; this item is classified ${componentCode}.`,
    );
  }
}

/**
 * A Trip cannot carry the same Custom Property twice — `trip_custom_property`
 * is unique on (trip_id, custom_property_id) — so its pricing must not charge
 * for it twice either.
 */
export class DuplicateCustomPropertyItemException extends ConflictException {
  constructor(customPropertyId: string, conflictingItemId: string) {
    super(
      `Custom property "${customPropertyId}" is already priced by item "${conflictingItemId}" in this snapshot.`,
    );
  }
}
