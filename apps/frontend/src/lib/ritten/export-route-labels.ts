import type { Trip, TripDirection } from "@/lib/api/types";
import { toLocationLabel } from "./export-location-codes";

/**
 * The Startpoint and Endpoint of one Trip, in the operator's own vocabulary.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
 * These labels are an EXPORT convention, not data. `BEQ869` is not a terminal
 * name, is not stored anywhere, and must never become a second name for a
 * terminal: the string a transport order printed IS the terminal, and a
 * translation layer between the two was built once before and had to be
 * deleted. So the vocabulary lives here, in the export rule, and nothing in the
 * Trip domain knows about it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── WHAT DECIDES THE LABELS ─────────────────────────────────────────────────
 * Two facts, and nothing else:
 *
 *   1. `trip.direction` — COLLECTION or DELIVERY, as the DOCUMENT stated it and
 *      as the parser recorded it. Never inferred from a terminal, a
 *      destination, a date, a booking number or a row order.
 *   2. whether the Trip belongs to a group — the existing Combination
 *      relationship.
 *
 * A Trip with no direction gets no vocabulary at all: a manual Trip has no
 * document that could have said which half it is, and inventing VOYAGE or
 * RELEASE for it would state something nobody knows.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The quay this business runs its voyages and releases through.
 *
 * An export label, deliberately a constant in one place: changing the wording
 * is one edit here, and it can never leak into terminal data.
 */
export const QUAY_CODE = "BEQ869";

export const VOYAGE_LABEL = `VOYAGE ${QUAY_CODE}`;
export const RELEASE_LABEL = `RELEASE ${QUAY_CODE}`;

/**
 * The join between the two legs of a Combination.
 *
 * A Combination is one truck movement doing two jobs: it brings an import
 * container out of the quay to a customer, then takes an export container from
 * another customer back to the quay. The two legs meet in the middle, and that
 * meeting point is what this word names — which is why it appears as the END of
 * the delivery and the START of the collection.
 */
export const COMBINATION_LABEL = "COMBINATION";

export interface RouteLabels {
  readonly startPoint: string;
  readonly endPoint: string;
}

/**
 * Whether this Trip is a leg of a genuine imported Combination.
 *
 * Two conditions, both required. A group alone is not enough: an operator can
 * put any Trips into a manual group as a convenience, and that group carries no
 * claim about directions or pairing. A direction alone is not enough either —
 * an ordinary import has one.
 *
 * A manual group therefore never produces Combination labels, which is the
 * point: the labels describe a document's structure, not an operator's tidying.
 */
export function isCombinationLeg(trip: Trip): boolean {
  return (
    trip.tripGroupId !== null &&
    (trip.direction === "COLLECTION" || trip.direction === "DELIVERY")
  );
}

export function toRouteLabels(trip: Trip): RouteLabels {
  const terminal = trip.terminal ?? "";
  const destination = trip.destinationCity ?? "";

  const isCombination = isCombinationLeg(trip);

  /*
   * Only the two directions a document can state produce vocabulary. Anything
   * else — null on a manual Trip, or a value this build does not know — falls
   * through to the plain stored route, because VOYAGE, RELEASE and COMBINATION
   * would each assert something nobody said.
   */
  switch (trip.direction) {
    case "DELIVERY":
      /*
       * Out of the quay to the customer — or to the middle of a Combination,
       * where the collection leg takes over.
       *
       * A normal delivery ends at the destination's configured export code
       * where the operator has one, and at the stored city where they do not.
       * The code is a spelling, not data: see `export-location-codes.ts`.
       */
      return {
        startPoint: VOYAGE_LABEL,
        endPoint: isCombination
          ? COMBINATION_LABEL
          : (toLocationLabel(destination) ?? destination),
      };

    case "COLLECTION":
      /*
       * An export container: released at the quay, then taken there for its
       * voyage. Both ends therefore name the quay — RELEASE where the container
       * is picked up, VOYAGE where it is handed over — unless this is the
       * second leg of a Combination, which instead starts at the join.
       */
      return {
        startPoint: isCombination ? COMBINATION_LABEL : RELEASE_LABEL,
        endPoint: VOYAGE_LABEL,
      };

    default:
      return { startPoint: terminal, endPoint: destination };
  }
}

/** Kept beside the labels so both readings of a direction stay in one file. */
export function directionOf(trip: Trip): TripDirection | null {
  return trip.direction;
}
