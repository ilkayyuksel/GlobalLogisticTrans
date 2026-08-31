import { Trip, TripStatus } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import type { TripRepository } from "./trip.repository";
import { BOOKING_NUMBER_HOLDING_STATUSES } from "./trip-status.rules";

/**
 * Which Trip an incoming UPDATE or CANCEL document is about.
 *
 * ── ONE RULE, ONE PLACE ─────────────────────────────────────────────────────
 * UPDATE and CANCEL both ask this question and must never answer it
 * differently, so neither owns the answer: this module does, and the revision
 * service is its only caller. Nothing in a controller, a repository or the IMAP
 * path decides identity.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * It is CONDITIONAL on what the document actually says:
 *
 *   container printed      → booking AND container, exactly.
 *   container absent       → booking alone.
 *
 * Both halves are scoped to the document's own transport date, which is the
 * third part of a Trip's identity. The same booking and container come round
 * again on a later date as a genuinely different transport, and an UPDATE for
 * one of them must never reach the other.
 *
 * Why the asymmetry is right: a COLLECTION order is written before anyone knows
 * which container will be picked up, so it prints none — and the operator may
 * type one in later. A CANCEL for that transport still prints no container, so
 * requiring one to match would leave real cancellations unapplied, which is
 * what it did.
 *
 * ── WHERE UPDATE AND CANCEL PART COMPANY ────────────────────────────────────
 * A document that PRINTS a container is matched strictly on it FIRST. What
 * happens when that finds nothing is the one place the two document kinds
 * disagree, and `ContainerMissRule` below is where that difference is named.
 *
 * An UPDATE refuses: booking A container Y naming no Trip means the transport
 * it describes is not here, and revising booking A container X instead would
 * rewrite a transport nobody sent an update for. The caller creates a Trip.
 *
 * A CANCEL falls back to the booking and the date, because a cancellation must
 * not fail over a container WE recorded differently — the order was placed
 * without one, an operator typed it in, and the customer cancels naming theirs.
 * A cancellation creates nothing, so the looser rule costs nothing.
 *
 * ── AMBIGUITY IS AN ANSWER ──────────────────────────────────────────────────
 * A booking legitimately carries several Trips, one per container. When a
 * document with no container names such a booking, there is no honest way to
 * choose between them — so nothing is chosen. Not the newest, not the oldest,
 * not the one that happens to be planned first. The caller is told the booking
 * is ambiguous and an operator decides.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type DocumentTripMatch =
  | { readonly kind: "MATCHED"; readonly trip: Trip; readonly method: MatchMethod }
  | { readonly kind: "NO_MATCHING_TRIP" }
  | { readonly kind: "AMBIGUOUS_BOOKING_MATCH"; readonly tripCount: number };

/** How the Trip was found, for the log and for the audit trail. */
export type MatchMethod = "BOOKING_AND_CONTAINER" | "BOOKING_ONLY";

/**
 * What a document naming a container does when no Trip carries that container.
 *
 * ── THE ONE PLACE UPDATE AND CANCEL DISAGREE ────────────────────────────────
 * Everything else about matching is shared, and deliberately so. This is the
 * single difference, named rather than duplicated, so the two rules sit side by
 * side and can be compared.
 *
 * `REFUSE` — an UPDATE. A revision that names a container nothing holds
 * describes a transport this system does not have, and the caller creates it.
 * Falling back would let an UPDATE for container Y silently rewrite the Trip
 * carrying container X.
 *
 * `FALL_BACK_TO_BOOKING_AND_DATE` — a CANCEL. A cancellation is an instruction
 * from the party that placed the order, and it must not fail because our record
 * of the container differs from theirs. The case it exists for: the order was
 * placed without a container, the operator typed one in afterwards, and the
 * cancellation names the container the customer knows. The exact identity finds
 * nothing, and refusing would leave a real cancellation unapplied — the same
 * failure that made a container-less CANCEL fall back to the booking.
 *
 * A cancellation never creates anything, which is why the looser rule is safe
 * here and would not be safe for an UPDATE.
 */
export type ContainerMissRule = "REFUSE" | "FALL_BACK_TO_BOOKING_AND_DATE";

export interface DocumentIdentity {
  readonly bookingNumber: string;
  readonly containerNumber: string | null;
  /**
   * The transport date the document itself states — the `Date/time:` line of
   * its LOADING or DELIVERY section, which is what `original_planning_date`
   * holds.
   *
   * Compared against the stored Trip's ORIGINAL date, never against its current
   * `planning_date`. An operator who re-plans a truck to another day changes
   * what is on the board, not which transport the order was for, so a later
   * UPDATE or CANCEL still names the date the document always named.
   */
  readonly originalPlanningDate: Date | null;
}

/**
 * A container number in the form Trips are stored and compared in.
 *
 * ── THE SAME FUNCTION THE PARSER USES ───────────────────────────────────────
 * `normalizeContainerNumber` lives in the parser package, which is where a
 * container number first appears and which the Backend already depends on. One
 * rule, shared — not a second, slightly different one here that could drift.
 *
 * It strips the formatting a document prints for a human — `EUCU 145129/5`
 * becomes `EUCU1451295` — so two printings of one container compare equal.
 *
 * Absence stays absence: null, blank and whitespace-only all give null. Three
 * identities separated by invisible characters would make matching depend on
 * what nobody can see.
 *
 * NEVER call this on a booking number: `ANRDUB2794719 /67036944` would be fused
 * into one meaningless string. See the parser's own note.
 */
export function toContainerIdentity(value: string | null | undefined): string | null {
  return normalizeContainerNumber(value);
}

/**
 * Resolves the Trip a document names, or says why it cannot.
 *
 * `statuses` is the set a match may be in — the same one that holds a booking
 * number, so a DELETED Trip never answers for a live document.
 */
export async function resolveTripForDocument(
  repository: TripRepository,
  identity: DocumentIdentity,
  onContainerMiss: ContainerMissRule,
  statuses: readonly TripStatus[] = BOOKING_NUMBER_HOLDING_STATUSES,
): Promise<DocumentTripMatch> {
  const containerNumber = toContainerIdentity(identity.containerNumber);

  if (containerNumber !== null) {
    const trip = await repository.findByIdentity({
      identity: {
        bookingNumber: identity.bookingNumber,
        containerNumber,
        originalPlanningDate: identity.originalPlanningDate,
      },
      statuses,
    });

    if (trip) {
      return { kind: "MATCHED", trip, method: "BOOKING_AND_CONTAINER" };
    }

    if (onContainerMiss === "REFUSE") {
      return { kind: "NO_MATCHING_TRIP" };
    }

    /*
     * A cancellation whose container matches nothing falls through to the
     * booking and the date — see `ContainerMissRule`. It is the SAME lookup a
     * container-less document uses, including its ambiguity rule, so the two
     * cannot answer differently.
     */
  }

  /*
   * The booking and the date are all there is to go on. Every Trip holding them
   * is read — not the first one — because the COUNT is the answer: one is a
   * match, several is an ambiguity nobody may resolve automatically.
   *
   * The date narrows the candidates but never picks between them. Two Trips on
   * one booking and one date are still ambiguous, and still nobody's to choose.
   * The Trip's CURRENT container number is not consulted here at all: it is the
   * operator's to change, and letting it decide the lookup is exactly what left
   * real cancellations unapplied.
   */
  const candidates = await repository.findManyByBookingNumberAndOriginalDate({
    bookingNumber: identity.bookingNumber,
    originalPlanningDate: identity.originalPlanningDate,
    statuses,
  });

  if (candidates.length === 0) {
    return { kind: "NO_MATCHING_TRIP" };
  }

  if (candidates.length > 1) {
    return {
      kind: "AMBIGUOUS_BOOKING_MATCH",
      tripCount: candidates.length,
    };
  }

  return {
    kind: "MATCHED",
    trip: candidates[0] as Trip,
    method: "BOOKING_ONLY",
  };
}
