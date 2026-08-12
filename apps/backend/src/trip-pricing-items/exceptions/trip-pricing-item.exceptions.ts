import { NotFoundException } from "@nestjs/common";

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
 * Only one exception remains. The module no longer creates pricing items — the
 * Pricing Engine writes a whole breakdown with its parent in one transaction —
 * so the rules that once guarded a single line's creation (unknown or inactive
 * component, a misplaced Custom Property reference, the same property priced
 * twice) can no longer be reached from anywhere and were removed with it.
 *
 * There is deliberately no "cannot delete" exception either: pricing items are
 * never removed individually.
 */
export class TripPricingItemNotFoundException extends NotFoundException {
  constructor(tripPricingItemId: string) {
    super(`Trip pricing item "${tripPricingItemId}" does not exist.`);
  }
}
