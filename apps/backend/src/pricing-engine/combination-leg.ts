import { TripDirection } from "@prisma/client";

/**
 * Whether a Trip is a leg of a GENUINE Combination, and which one.
 *
 * ── WHY THIS IS NOT SIMPLY "HAS A GROUP" ────────────────────────────────────
 * Two different things share the TripGroup table. A Combination comes from ONE
 * transport order that printed two legs — an outbound delivery and a return
 * collection — and means something to pricing. A manual group is an operator
 * convenience: any Trips at all, tied together for their own reasons, carrying
 * no claim about directions or pairing.
 *
 * Only the first is a Combination, so only the first may change what a Trip is
 * charged. The evidence that separates them is persisted and needs no guessing:
 * the legs of a Combination were created from the SAME PdfDocument, because one
 * document produced both. Trips an operator grouped by hand come from different
 * documents, or from none.
 *
 * Nothing here reads a planning date, a row order, a booking number or the
 * order the trips happen to arrive in.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The minimum a Trip must expose for this rule to be applied to it. */
export interface CombinationMember {
  readonly id: string;
  readonly tripGroupId: string | null;
  readonly pdfDocumentId: string | null;
  readonly direction: TripDirection | null;
}

/** A Combination is one leg out and one leg back — never more, never fewer. */
const LEGS_PER_COMBINATION = 2;

export const CombinationLeg = {
  /** The outbound leg: out of the quay to the customer. */
  DELIVERY: "DELIVERY",
  /** The return leg: from the customer back to the quay. */
  COLLECTION: "COLLECTION",
  /** Not part of a Combination at all — an ordinary Trip, or a manual group. */
  NONE: "NONE",
  /**
   * The Trips of one document are grouped but do not form one delivery and one
   * collection. Reported rather than priced: see `combinationLegOf`.
   */
  INVALID: "INVALID",
} as const;

export type CombinationLeg =
  (typeof CombinationLeg)[keyof typeof CombinationLeg];

/**
 * Which leg of a genuine Combination `trip` is.
 *
 * `groupMembers` is every Trip sharing its group, including the Trip itself.
 *
 * The three outcomes that matter:
 *
 *   NONE      no group, or a group whose members came from elsewhere — the
 *             manual case. Priced as an ordinary Trip.
 *   DELIVERY  the outbound leg of a document's pair.
 *   COLLECTION the return leg of the same pair.
 *
 * INVALID is the fourth, and it exists so a malformed pair is never priced on a
 * guess. It means the Trips of ONE document are grouped and yet are not one
 * delivery and one collection — something no real transport order produces, and
 * something the caller must report rather than resolve.
 */
export function combinationLegOf(
  trip: CombinationMember,
  groupMembers: readonly CombinationMember[],
): CombinationLeg {
  if (trip.tripGroupId === null || trip.pdfDocumentId === null) {
    return CombinationLeg.NONE;
  }

  // The legs of one order came from one document. Anything else in the group
  // was put there by hand and says nothing about this Trip.
  const fromSameDocument = groupMembers.filter(
    (member) =>
      member.tripGroupId === trip.tripGroupId &&
      member.pdfDocumentId === trip.pdfDocumentId,
  );

  if (fromSameDocument.length < LEGS_PER_COMBINATION) {
    // One Trip of a document, grouped with Trips from other documents: this is
    // a manual group, and the Trip is priced as an ordinary one.
    return CombinationLeg.NONE;
  }

  const directions = fromSameDocument.map((member) => member.direction);
  const isWellFormed =
    fromSameDocument.length === LEGS_PER_COMBINATION &&
    directions.filter((direction) => direction === TripDirection.DELIVERY)
      .length === 1 &&
    directions.filter((direction) => direction === TripDirection.COLLECTION)
      .length === 1;

  if (!isWellFormed) {
    return CombinationLeg.INVALID;
  }

  return trip.direction === TripDirection.DELIVERY
    ? CombinationLeg.DELIVERY
    : CombinationLeg.COLLECTION;
}
