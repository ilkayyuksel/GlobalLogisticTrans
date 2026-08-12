import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for the RouteCost module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * No message carries an amount: these are written to the log, and a configured
 * route cost is commercial information.
 *
 * There is deliberately no "cannot delete" exception: route costs are never
 * physically deleted, so the module exposes no delete operation at all.
 */

export class RouteCostNotFoundException extends NotFoundException {
  constructor(routeCostId: string) {
    super(`Route cost "${routeCostId}" does not exist.`);
  }
}

export class UnknownPricingComponentException extends NotFoundException {
  constructor(pricingComponentId: string) {
    super(`Pricing component "${pricingComponentId}" does not exist.`);
  }
}

/**
 * Only a route-dependent component takes its amount from a route cost.
 *
 * A component is route-priced when a Custom Property links to it — that link is
 * the model's expression of "this component applies per Trip and is priced per
 * route" (database_model.md §4.12). Every other component resolves its amount
 * elsewhere: BASE_PRICE from route pricing or distance, FUEL_SURCHARGE,
 * COMBINATION and WAITING_TIME from Settings, CUSTOM_PROPERTY from the
 * property's own default price. A route cost for any of those would be
 * configuration nothing ever reads.
 */
export class ComponentNotRoutePricedException extends ConflictException {
  constructor(componentCode: string) {
    super(
      `Pricing component "${componentCode}" is not route-priced, so it cannot have a route cost. Only components linked to a custom property take their amount from route costs.`,
    );
  }
}

export class DuplicateRouteCostException extends ConflictException {
  constructor(departure: string, destination: string, componentCode: string) {
    super(
      `An active ${componentCode} route cost already exists for "${departure}" to "${destination}".`,
    );
  }
}
