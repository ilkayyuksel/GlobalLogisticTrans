import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for the RoutePricing module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * There is deliberately no "cannot delete" exception: route pricing records are
 * never physically deleted, so the module exposes no delete operation at all.
 */

export class RoutePricingNotFoundException extends NotFoundException {
  constructor(routePricingId: string) {
    super(`Route pricing "${routePricingId}" does not exist.`);
  }
}

export class DuplicateActiveRouteException extends ConflictException {
  constructor(departure: string, destination: string) {
    super(
      `An active route pricing already exists for "${departure}" to "${destination}".`,
    );
  }
}
