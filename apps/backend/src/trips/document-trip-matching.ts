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
 * ── THE RULE, IN TWO PHASES ────────────────────────────────────────────────
 * 1. the whole identity — booking, container and the document's own transport
 *    date — tried only when the document states a container;
 * 2. the booking and that date, with the container dropped entirely.
 *
 * A phase that finds ONE Trip answers. A phase that finds NOTHING hands on to
 * the next. Phase 2 is the last, so its count is final.
 *
 * ── WHY THE CONTAINER IS DROPPED, AND ONLY LAST ────────────────────────────
 * A container printed on an incoming document does not reliably identify a
 * Trip. A COLLECTION order is written before anyone knows which container will
 * be picked up, so it prints none and an operator types one in later — and the
 * next document for that transport may well carry it. Matching strictly on the
 * container left real revisions and real cancellations unapplied.
 *
 * So the container is used while it helps and abandoned when it does not. It is
 * never abandoned FIRST: a document naming a container we hold must reach that
 * Trip and no other.
 *
 * The DATE is never dropped. The same booking comes round again a week later as
 * a different transport, and no fallback may reach across it.
 *
 * ── UPDATE AND CANCEL ANSWER ALIKE ─────────────────────────────────────────
 * They once differed on what a container miss meant: a cancellation fell back
 * to the booking and the date, a revision refused and let the caller create a
 * Trip. Both now reach the same last phase, so the distinction no longer
 * changes any outcome and the rule that expressed it is gone. What a caller
 * DOES with the answer still differs — a revision may create, a cancellation
 * never does.
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
  statuses: readonly TripStatus[] = BOOKING_NUMBER_HOLDING_STATUSES,
): Promise<DocumentTripMatch> {
  const containerNumber = toContainerIdentity(identity.containerNumber);

  /*
   * ── PHASE 1: the whole identity ────────────────────────────────────────────
   * Only when the document states a container. At most one live Trip can hold
   * a given booking, container and date — the unique index guarantees it — so
   * this phase answers with one Trip or with nothing, never with an ambiguity.
   */
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
  }

  /*
   * ── PHASE 2, THE LAST: the booking and the date ────────────────────────────
   * Reached only because Phase 1 found NOTHING, and it drops the container
   * entirely.
   *
   * That is deliberate, and it is why this phase is last. A container printed
   * on an incoming document does not reliably identify a Trip: an order placed
   * without one is given a container by hand afterwards, and the document that
   * follows may carry it. Refusing on that mismatch left real revisions and
   * real cancellations unapplied.
   *
   * The date is NOT dropped with it. A booking that comes round again a week
   * later is a different transport, and no fallback may reach across it.
   *
   * The COUNT is the answer: one is a match, several is an ambiguity nobody may
   * resolve automatically. The Trip's CURRENT container is not consulted at all
   * — it is the operator's to change, and letting it decide is exactly what
   * this phase exists to stop.
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
