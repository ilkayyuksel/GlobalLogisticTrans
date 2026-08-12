import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for the CustomProperty module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * There is deliberately no "cannot delete" exception: properties are never
 * physically deleted, so the module exposes no delete operation at all.
 */

export class CustomPropertyNotFoundException extends NotFoundException {
  constructor(customPropertyId: string) {
    super(`Custom property "${customPropertyId}" does not exist.`);
  }
}

export class DuplicateCustomPropertyNameException extends ConflictException {
  constructor(name: string) {
    super(`An active custom property named "${name}" already exists.`);
  }
}

/** The referenced PricingComponent does not exist in the catalog. */
export class UnknownPricingComponentException extends NotFoundException {
  constructor(pricingComponentId: string) {
    super(`Pricing component "${pricingComponentId}" does not exist.`);
  }
}

/**
 * A route-priced property carries no price of its own.
 *
 * database_model.md §4.12: the amount comes from the RouteCost configuration,
 * so a default price here would silently never be used. The database enforces
 * the same rule with a CHECK; this produces the message that explains it.
 */
export class LinkedPropertyMustHaveNoPriceException extends ConflictException {
  constructor(pricingComponentId: string) {
    super(
      `A custom property linked to pricing component "${pricingComponentId}" must not define a default price. Its amount comes from the route cost configuration.`,
    );
  }
}

/**
 * A component may be reached through at most one active property.
 *
 * Two would let a single charge produce two pricing lines for one Trip.
 */
export class DuplicateComponentLinkException extends ConflictException {
  constructor(pricingComponentId: string) {
    super(
      `An active custom property is already linked to pricing component "${pricingComponentId}".`,
    );
  }
}
