import { TripDirection, TripStatus } from "@prisma/client";

/**
 * Two questions a Trip's group answers, kept apart on purpose.
 *
 * ── DOES THIS TRIP CARRY THE COMBINATION SURCHARGE? ─────────────────────────
 * Group membership, and nothing else. Every Trip in a TripGroup — an imported
 * Combination or a group an operator made by hand, closed before or after it
 * joined, alone in its group or not — carries its own Backload on its own
 * snapshot. A group of two is two surcharges, never one shared between them.
 * See `carriesCombinationSurcharge`.
 *
 * This reverses an earlier rule under which only a genuine Combination (below)
 * carried the surcharge and a manual group was priced as ordinary Trips. The
 * business changed that in September 2026.
 *
 * ── WHICH LEG OF A GENUINE COMBINATION IS IT, FOR TAR? ──────────────────────
 * A genuine Combination is ONE transport order that printed two legs — an
 * outbound delivery and a return collection. It decides where the automatic
 * TAR belongs: once per pair, on one leg. The evidence is persisted and needs
 * no guessing: the legs of a Combination were created from the SAME
 * PdfDocument. Trips an operator grouped by hand come from different documents,
 * or from none, and are legs of nothing.
 *
 * Nothing here reads a planning date, a row order, a booking number or the
 * order the trips happen to arrive in.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The minimum a Trip must expose for these rules to be applied to it. */
export interface CombinationMember {
  readonly id: string;
  readonly tripGroupId: string | null;
  readonly pdfDocumentId: string | null;
  readonly direction: TripDirection | null;
  /** Read only for the pricing partner: see `isPricingPartnerStatus`. */
  readonly status: TripStatus;
}

/** A Combination is one leg out and one leg back — never more, never fewer. */
const LEGS_PER_COMBINATION = 2;

export const CombinationLeg = {
  /** The outbound leg: out of the quay to the customer. */
  DELIVERY: "DELIVERY",
  /** The return leg: from the customer back to the quay. */
  COLLECTION: "COLLECTION",
  /** Not part of a genuine Combination — an ordinary Trip, or a manual group. */
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
 * Whether a Trip carries the Combination Surcharge — the Backload.
 *
 * A Trip in a group does; a Trip in none does not. The member left behind when
 * its partner is unlinked is still in its group and keeps it; only the Trip
 * that leaves goes back to none. The one place this is decided: the Engine
 * prices with it, and the BASIS export and the Rittenlijst only show the
 * stored result.
 */
export function carriesCombinationSurcharge(
  trip: Pick<CombinationMember, "tripGroupId">,
): boolean {
  return trip.tripGroupId !== null;
}

/**
 * Which leg of a genuine Combination `trip` is, for TAR allocation.
 *
 * `groupMembers` is every Trip sharing its group, including the Trip itself.
 *
 * The three outcomes that matter:
 *
 *   NONE      no group, or a group whose members came from elsewhere — the
 *             manual case. TAR is decided as for an ordinary Trip.
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
  // was put there by hand and says nothing about this Trip's leg.
  const fromSameDocument = groupMembers.filter(
    (member) =>
      member.tripGroupId === trip.tripGroupId &&
      member.pdfDocumentId === trip.pdfDocumentId,
  );

  if (fromSameDocument.length < LEGS_PER_COMBINATION) {
    // One Trip of a document, grouped with Trips from other documents: a
    // manual group, and no leg of a pair.
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

/**
 * The Trips whose TAR leg a change of group membership re-classified.
 *
 * `before` and `after` are the SAME Trips, as they were and as they are: every
 * Trip the change touched and every other member of the groups involved,
 * because a leg is decided by the whole group and not by the Trip alone.
 *
 * Splitting a genuine pair moves BOTH legs, because a lone leg is no longer a
 * leg of anything. Nothing here is a second definition — both sides are
 * `combinationLegOf`.
 */
export function tripsWhoseLegChanged(
  before: readonly CombinationMember[],
  after: readonly CombinationMember[],
): string[] {
  const legBefore = new Map(
    before.map((trip) => [trip.id, combinationLegOf(trip, before)]),
  );

  return after
    .filter((trip) => combinationLegOf(trip, after) !== legBefore.get(trip.id))
    .map((trip) => trip.id);
}

/**
 * The Trips a change of group membership left priced on a stale answer.
 *
 * ── WHY PRICING HAS TO BE TOLD ──────────────────────────────────────────────
 * Grouping and ungrouping write nothing but `tripGroupId`, so a Trip that was
 * already priced keeps the answer its PREVIOUS group gave until something
 * prices it again. Two answers can go stale:
 *
 *   the Backload  every Trip whose group changed — joining a group adds it,
 *                 leaving one removes it;
 *   the TAR leg   every Trip whose leg changed, which can include a member
 *                 whose own group did not: splitting a genuine pair leaves the
 *                 other leg an ordinary Trip for TAR, though it keeps its
 *                 Backload because it is still in its group.
 *
 * `before` and `after` are the SAME Trips, as they were and as they are.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function tripsRepricedByRegrouping(
  before: readonly CombinationMember[],
  after: readonly CombinationMember[],
): string[] {
  const groupBefore = new Map(before.map((trip) => [trip.id, trip.tripGroupId]));
  const legChanged = new Set(tripsWhoseLegChanged(before, after));
  const partnerBefore = new Map(
    before.map((trip) => [trip.id, partnerIdOf(trip, before)]),
  );

  return after
    .filter(
      (trip) =>
        legChanged.has(trip.id) ||
        groupBefore.get(trip.id) !== trip.tripGroupId ||
        // The pair its route price is matched on changed: a member left alone
        // in a two-Trip group is no longer half of a priced pair.
        partnerBefore.get(trip.id) !== partnerIdOf(trip, after),
    )
    .map((trip) => trip.id);
}

/**
 * The statuses a Trip may be a pricing partner in: OPEN and CLOSED. An OPEN
 * partner has no price of its own yet, but its road and date are real and the
 * CLOSED leg is priced on the pair. CANCELLED and DELETED work is not carried
 * out, so it pairs with nothing.
 */
export const PRICING_PARTNER_STATUSES: readonly TripStatus[] = [
  TripStatus.OPEN,
  TripStatus.CLOSED,
];

export function isPricingPartnerStatus(status: TripStatus): boolean {
  return PRICING_PARTNER_STATUSES.includes(status);
}

/** How a Trip came to have a pricing partner. */
export const PricingPairBasis = {
  /** One document, one DELIVERY and one COLLECTION: `combinationLegOf`. */
  SAME_DOCUMENT: "SAME_DOCUMENT",
  /** The only other member of a group of exactly two, whatever its document. */
  TWO_TRIP_GROUP: "TWO_TRIP_GROUP",
} as const;

export type PricingPairBasis = (typeof PricingPairBasis)[keyof typeof PricingPairBasis];

export type PricingPartner<T extends CombinationMember> =
  | { readonly kind: "PAIRED"; readonly partner: T; readonly basis: PricingPairBasis }
  | { readonly kind: "UNPAIRED"; readonly reason: "NOT_GROUPED" | "NO_UNAMBIGUOUS_PARTNER" };

/**
 * The Trip whose road, together with this Trip's, may select a configured
 * Combination route price — or why there is none.
 *
 * ── WHICH PAIRS, AS THE BUSINESS DECIDED (OCTOBER 2026) ─────────────────────
 *   a genuine pair from one document (`combinationLegOf`) — the other leg of
 *     that document, in a group of any size, as before;
 *   otherwise, a group of EXACTLY two Trips — the other member, whatever its
 *     document or direction: an operator's group of two is a candidate pair;
 *   anything else — no group, or a larger group with no genuine pair in it —
 *     has no pricing partner: which of several members would be the other leg
 *     is not something to guess.
 *
 * A partner is only a candidate. Whether the pair IS a configured Combination
 * is the central pair match's answer (`matchCombinationPair`), in each road's
 * real driving direction. TAR allocation does not read this: it keeps the
 * genuine same-document rule.
 */
export function pricingPartnerOf<T extends CombinationMember>(
  trip: T,
  members: readonly T[],
): PricingPartner<T> {
  if (trip.tripGroupId === null) {
    return { kind: "UNPAIRED", reason: "NOT_GROUPED" };
  }

  /*
   * CANCELLED and DELETED Trips are filtered out FIRST, before any rule below
   * reads the group: an excluded Trip is never a candidate, so no fallback can
   * pick it, and a group counts its ACTIVE members (a group of three with one
   * cancelled is a group of two). The owner's rules, October 2026.
   */
  const group = members.filter(
    (member) =>
      member.tripGroupId === trip.tripGroupId &&
      (member.id === trip.id || isPricingPartnerStatus(member.status)),
  );
  const leg = combinationLegOf(trip, group);

  if (leg === CombinationLeg.DELIVERY || leg === CombinationLeg.COLLECTION) {
    const partner = group.find(
      (member) => member.id !== trip.id && member.pdfDocumentId === trip.pdfDocumentId,
    );

    if (partner) {
      return { kind: "PAIRED", partner, basis: PricingPairBasis.SAME_DOCUMENT };
    }
  }

  // Whether or not the caller's list includes the Trip itself, one other
  // member means a group of exactly two.
  const others = group.filter((member) => member.id !== trip.id);

  if (others.length === 1) {
    return { kind: "PAIRED", partner: others[0], basis: PricingPairBasis.TWO_TRIP_GROUP };
  }

  return { kind: "UNPAIRED", reason: "NO_UNAMBIGUOUS_PARTNER" };
}

function partnerIdOf(
  trip: CombinationMember,
  members: readonly CombinationMember[],
): string | null {
  const pairing = pricingPartnerOf(trip, members);

  return pairing.kind === "PAIRED" ? pairing.partner.id : null;
}
