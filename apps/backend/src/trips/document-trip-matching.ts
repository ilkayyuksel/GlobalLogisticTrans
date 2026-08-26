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
 * Why the asymmetry is right: a COLLECTION order is written before anyone knows
 * which container will be picked up, so it prints none — and the operator may
 * type one in later. A CANCEL for that transport still prints no container, so
 * requiring one to match would leave real cancellations unapplied, which is
 * what it did.
 *
 * ── AND WHY IT IS NOT A FALLBACK ────────────────────────────────────────────
 * A document that PRINTS a container is matched strictly on it. It does NOT
 * fall back to booking-only when that container matches nothing: booking A
 * container Y naming no Trip means the transport it describes is not here, and
 * cancelling booking A container X instead would cancel a transport nobody
 * asked about.
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

export interface DocumentIdentity {
  readonly bookingNumber: string;
  readonly containerNumber: string | null;
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
  statuses: readonly TripStatus[] = BOOKING_NUMBER_HOLDING_STATUSES,
): Promise<DocumentTripMatch> {
  const containerNumber = toContainerIdentity(identity.containerNumber);

  if (containerNumber !== null) {
    const trip = await repository.findByIdentity({
      identity: { bookingNumber: identity.bookingNumber, containerNumber },
      statuses,
    });

    return trip
      ? { kind: "MATCHED", trip, method: "BOOKING_AND_CONTAINER" }
      : { kind: "NO_MATCHING_TRIP" };
  }

  /*
   * No container printed, so the booking is all there is to go on. Every Trip
   * holding it is read — not the first one — because the COUNT is the answer:
   * one is a match, several is an ambiguity nobody may resolve automatically.
   */
  const candidates = await repository.findManyByBookingNumber({
    bookingNumber: identity.bookingNumber,
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
