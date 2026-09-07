import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for the CustomProperty module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * A property CAN now be physically deleted, so the refusals below say exactly
 * which reference stands in the way. Each names a real dependency in the
 * model — never a policy invented here.
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

/**
 * The property is still carried by Trips.
 *
 * `trip_custom_property.custom_property_id` is NOT NULL with ON DELETE
 * RESTRICT, so the row cannot go while any assignment points at it. Withdrawing
 * those assignments is an operator decision about real Trips, and doing it
 * automatically would silently change what those Trips are worth — so the count
 * is reported and the deletion refused.
 */
export class CustomPropertyInUseException extends ConflictException {
  constructor(name: string, assignmentCount: number) {
    super(
      `Custom property "${name}" is still assigned to ${assignmentCount} ` +
        `${assignmentCount === 1 ? "Trip" : "Trips"}. ` +
        "Remove those assignments first, or deactivate the property instead.",
    );
  }
}

/**
 * The property is named by FROZEN pricing history.
 *
 * `trip_pricing_item` holds what a Trip was actually charged. Its `description`
 * and `amount` are denormalised onto the row, so the money would survive the
 * property disappearing — but the foreign key is RESTRICT, and this module does
 * not weaken it. Deleting the property would either destroy priced history or
 * require changing that constraint, and neither belongs behind a delete button.
 */
export class CustomPropertyHasPricingHistoryException extends ConflictException {
  constructor(name: string, itemCount: number) {
    super(
      `Custom property "${name}" appears in ${itemCount} frozen pricing ` +
        `${itemCount === 1 ? "line" : "lines"}. ` +
        "Historical pricing must stay explainable, so it cannot be deleted. " +
        "Deactivate it instead.",
    );
  }
}

/**
 * The property is one the SYSTEM owns.
 *
 * The same classification `systemManagedReasonFor` already applies to manual
 * assignment, applied here to the row itself. Deleting one of these does not
 * merely remove a row: TAR is what `AUTOMATIC_CUSTOM_PROPERTY_ID` points at,
 * Flat is what the container-type rule looks up by name, and Toll and Tunnel
 * are how the route configuration reaches its components. Each would take a
 * working pricing rule with it.
 */
export class SystemManagedCustomPropertyDeletionException extends ConflictException {
  constructor(name: string, explanation: string) {
    super(
      `Custom property "${name}" is managed by the system and cannot be ` +
        `deleted: ${explanation}.`,
    );
  }
}
