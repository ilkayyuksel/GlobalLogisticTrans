import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for the route configuration screen.
 *
 * Deliberately few. This module composes two existing services and inherits
 * their refusals — a duplicate active route, an unknown record, an amount out
 * of range are all raised where the rule lives. Only what is genuinely new
 * here needs an exception of its own.
 */

export class RouteConfigurationNotFoundException extends NotFoundException {
  constructor(readonly routeConfigurationId: string) {
    super(`Route configuration "${routeConfigurationId}" does not exist.`);
  }
}

/**
 * The catalog does not hold the pricing component this screen configures.
 *
 * Toll and Tunnel are seeded components, so this cannot happen on a healthy
 * database — which is exactly why it is refused loudly rather than skipped.
 * Writing a route with no Toll row because the component was missing would
 * silently stop charging tolls on that route.
 */
export class UnknownPricingComponentException extends ConflictException {
  constructor(readonly componentCode: string) {
    super(
      `Pricing component "${componentCode}" is not in the catalog, so a route cost cannot be configured for it.`,
    );
  }
}
