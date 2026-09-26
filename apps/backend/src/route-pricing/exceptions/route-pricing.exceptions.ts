import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

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

/** A Combination is one leg out and one leg back — never more, never fewer. */
export const LEGS_PER_COMBINATION_ROUTE = 2;

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

export class CombinationRouteGroupNotFoundException extends NotFoundException {
  constructor(combinationGroupId: string) {
    super(
      `Combination route configuration "${combinationGroupId}" does not exist.`,
    );
  }
}

/**
 * A Combination is two legs — an outbound and a return — and never any other
 * number.
 *
 * Raised rather than silently accepted, because a Combination with one leg is
 * not a partially configured Combination: it is a configuration that would
 * price one direction and quietly charge nothing for the other. The DTO refuses
 * the same thing at the edge; this guards the service, which is also called
 * from inside the application.
 */
export class InvalidCombinationLegCountException extends BadRequestException {
  constructor(legCount: number) {
    super(
      `A Combination route configuration has exactly ${LEGS_PER_COMBINATION_ROUTE} legs, not ${legCount}.`,
    );
  }
}

/**
 * A leg cannot be changed on its own either.
 *
 * The ordinary route endpoints would treat it as a road: moving it would leave
 * its partner behind, and its tunnel would be written as a cost of the road
 * rather than of the leg — silently changing what every ordinary Trip on that
 * road pays. Both legs are edited together or not at all.
 */
export class CombinationLegNotSeparatelyEditableException extends ConflictException {
  constructor(routePricingId: string, combinationGroupId: string) {
    super(
      `Route pricing "${routePricingId}" is a leg of Combination route configuration "${combinationGroupId}" and cannot be changed on its own. Change the Combination instead, which edits both legs together.`,
    );
  }
}

/**
 * A leg cannot be removed on its own.
 *
 * Deleting one half would leave a Combination that prices one direction, so the
 * whole configuration goes or none of it does. The caller is told which group to
 * delete instead of being given a way to break the pair.
 */
export class CombinationLegNotSeparatelyRemovableException extends ConflictException {
  constructor(routePricingId: string, combinationGroupId: string) {
    super(
      `Route pricing "${routePricingId}" is a leg of Combination route configuration "${combinationGroupId}" and cannot be removed on its own. Remove the Combination instead.`,
    );
  }
}
