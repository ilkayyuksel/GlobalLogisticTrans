import { AUTOMATIC_CUSTOM_PROPERTY_NAME } from "../settings/pricing-settings.catalog";
import { FLAT_CUSTOM_PROPERTY_NAME } from "../trips/flat-container-rule";

/**
 * Which Custom Properties the SYSTEM owns, and which an operator may assign.
 *
 * ── THE DISTINCTION THIS EXPRESSES ──────────────────────────────────────────
 * Two different things had been sharing one table. A genuine per-Trip property
 * is a decision only the operator can make — this trip needed uncoupling, that
 * one waited — and assigning it is how the charge comes to exist. A
 * system-managed one is not a decision at all: something else in the model
 * already determines whether it applies, and offering it in a picker invites an
 * operator to contradict a rule, or to forget a charge that was never theirs to
 * remember.
 *
 * ── DERIVED FROM THE MODEL, NEVER FROM A LIST OF PRICED NAMES ───────────────
 * Each reason below is an existing mechanism, not a new one, and none of them
 * is "this property has a price" — Aan/Afkoppelen has a price and is entirely
 * manual.
 *
 *   1. A PRICING COMPONENT LINK. `database_model.md` §4.12: a property that
 *      references a component takes its amount from the route cost
 *      configuration. The ROUTE decides what it costs and, since this change,
 *      whether it applies at all — so Toll and Tunnel are the route's business
 *      end to end. This reason names no component, so a route-priced component
 *      added later is covered without touching this file.
 *
 *   2. THE AUTOMATIC PROPERTY. TAR is applied by the Pricing Engine itself,
 *      once on a standalone Trip and once on a Combination's DELIVERY leg. It
 *      is never stored as an assignment, so an operator picking it would create
 *      a second, contradictory row.
 *
 *   3. THE CONTAINER-TYPE PROPERTY. Flat is written by
 *      `AutomaticFlatPropertyService` from the container type: a 20FL is a flat
 *      rack whether or not anybody ticks a box, which is exactly why that
 *      service exists.
 *
 * ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────────────
 * Tarief, Brandstof, Backload and the Cost Confirmation are absent because they
 * are not Custom Properties at all. Each is a pricing component with its own
 * calculator, and no property in the catalog references them, so there is
 * nothing for an operator to pick.
 *
 * Waiting time is absent for the opposite reason: it is a Trip FIELD the
 * operator types in, priced automatically from it. Manual input, automatic
 * amount — and nothing here should ever make that input harder to reach.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The minimum a property must expose to be classified.
 *
 * `pricingComponentId` is optional as well as nullable: an ABSENT link and an
 * explicitly null one both mean the same thing — no component — and treating a
 * missing field as "linked" would classify an ordinary property as
 * system-managed and refuse an assignment that should be allowed.
 */
export interface ClassifiableCustomProperty {
  readonly name: string;
  readonly pricingComponentId?: string | null;
}

/** Why a property is system-managed, for the message an operator reads. */
export type SystemManagedReason =
  | "ROUTE_PRICED"
  | "AUTOMATIC_PRICING"
  | "CONTAINER_TYPE";

/**
 * The reason this property is system-managed, or null when it is the
 * operator's to assign.
 */
export function systemManagedReasonFor(
  property: ClassifiableCustomProperty,
): SystemManagedReason | null {
  // Null and undefined alike mean "no component link".
  if (property.pricingComponentId != null) {
    return "ROUTE_PRICED";
  }

  if (matchesName(property.name, AUTOMATIC_CUSTOM_PROPERTY_NAME)) {
    return "AUTOMATIC_PRICING";
  }

  if (matchesName(property.name, FLAT_CUSTOM_PROPERTY_NAME)) {
    return "CONTAINER_TYPE";
  }

  return null;
}

/** Whether the system decides this property, rather than an operator. */
export function isSystemManagedProperty(
  property: ClassifiableCustomProperty,
): boolean {
  return systemManagedReasonFor(property) !== null;
}

/** What to tell an operator who tried to assign one by hand. */
export const SYSTEM_MANAGED_EXPLANATION: Record<SystemManagedReason, string> = {
  ROUTE_PRICED:
    "its amount and whether it applies both come from the route configuration",
  AUTOMATIC_PRICING:
    "the Pricing Engine applies it automatically — once on a standalone Trip, and once on the DELIVERY leg of a genuine Combination",
  CONTAINER_TYPE: "the Trip's container type decides it",
};

/**
 * Names are compared the way the catalog enforces uniqueness: trimmed and
 * case-insensitively. A property called `tar` is the same property.
 *
 * A missing name matches nothing rather than throwing. The two name-based
 * reasons are the narrow ones, and a property whose name cannot be read is
 * better treated as ordinary than as un-assignable.
 */
function matchesName(candidate: string | null | undefined, name: string): boolean {
  return (candidate ?? "").trim().toLowerCase() === name.trim().toLowerCase();
}
