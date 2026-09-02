import { Injectable } from "@nestjs/common";
import { Trip } from "@prisma/client";
import { parse, type ParsedCostConfirmation } from "@tms/parser";

import { bookingNumberDigits } from "../common/booking-digits";
import { toIsoDate } from "../common/dates";
import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { toContainerIdentity } from "../trips/document-trip-matching";
import { TripService } from "../trips/trip.service";

/**
 * Which Trip a Cost Confirmation belongs to.
 *
 * ── WHY THIS IS NOT TRIP IDENTITY ───────────────────────────────────────────
 * A transport order is matched on booking + container + original date, because
 * it IS that transport. A confirmation is a different document making a
 * different claim: it says money is owed for a transport we already hold. It is
 * produced by another system, which prints the booking number in its own way
 * and sometimes cannot read the container at all.
 *
 * ── THE RULE, IN THREE PHASES ──────────────────────────────────────────────
 * 1. the booking EXACTLY, the date, and the container rule;
 * 2. the same, with the booking numbers reduced to their digits;
 * 3. the booking and the date alone, with the container rule dropped.
 *
 * A phase that finds ONE Trip answers. A phase that finds SEVERAL reports an
 * ambiguity and STOPS — a looser phase could only ever find more, so a tie is
 * never broken by relaxing the rule. Only a phase that finds NOTHING hands on.
 *
 * Each phase loosens exactly one thing. Phase 2 loosens how the booking number
 * is spelled; Phase 3 loosens the container. The DATE is never loosened: a
 * booking that comes round again on another day is a different transport, and
 * no fallback may reach across it.
 *
 * ── THE CONTAINER RULE, AND WHY PHASE 3 ABANDONS IT ────────────────────────
 * A confirmation naming a usable container matches only the Trip holding that
 * container. One naming none matches only a Trip whose ORIGINAL transport order
 * printed none either — read from the document the Trip was created from, never
 * from the Trip's current container number, which an operator may have typed in
 * afterwards.
 *
 * That is right while it works, and it is why the rule is tried first. But the
 * container printed on a confirmation does not reliably identify a Trip either:
 * an order placed without one is given a container by hand, and the
 * confirmation that follows may carry exactly that value — so the strict rule
 * refuses money that plainly belongs to the Trip. Phase 3 is the safety net for
 * that case, and it is last precisely because it can only be right once the
 * stricter readings have found nothing at all.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type CostConfirmationMatch =
  | { readonly kind: "MATCHED"; readonly trip: Trip }
  | { readonly kind: "NO_MATCHING_TRIP" }
  | { readonly kind: "AMBIGUOUS"; readonly trips: readonly Trip[] };

/** What a confirmation states about the transport it is paying for. */
export interface ConfirmationIdentity {
  readonly bookingNumber: string;
  /** ISO date the confirmation's own section printed. */
  readonly transportDate: string | null;
  /** Canonical container, or null when the document named none usable. */
  readonly containerReference: string | null;
}

export function identityOfConfirmation(
  confirmation: ParsedCostConfirmation,
): ConfirmationIdentity {
  return {
    bookingNumber: confirmation.bookingNumber,
    transportDate: confirmation.transportDate,
    containerReference: toContainerIdentity(confirmation.containerReference),
  };
}

@Injectable()
export class CostConfirmationMatchingService {
  constructor(
    private readonly trips: TripService,
    private readonly pdfDocuments: PdfDocumentService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(CostConfirmationMatchingService.name);
  }

  async findTripForCostConfirmation(
    identity: ConfirmationIdentity,
  ): Promise<CostConfirmationMatch> {
    /*
     * Without a date nothing can be matched: the date is what separates two
     * transports on one booking, and dropping the requirement would attach
     * money to whichever Trip happened to be found first.
     */
    if (identity.transportDate === null) {
      this.logger.warn("Cost confirmation states no transport date", {
        bookingNumber: identity.bookingNumber,
      });

      return { kind: "NO_MATCHING_TRIP" };
    }

    const exact = await this.trips.findByExactBookingNumber(
      identity.bookingNumber,
    );

    /* PHASE 1 — the exact booking, the date, and the container rule. */
    const strict = await this.eligibleAmong(exact, identity);

    if (strict.length > 0) {
      return this.decide(strict);
    }

    /*
     * PHASE 2 — the same rule, with the booking numbers reduced to their
     * digits. Reached only because Phase 1 found NOTHING.
     */
    const digits = bookingNumberDigits(identity.bookingNumber);

    const byDigits =
      digits === null ? [] : await this.trips.findByBookingDigits(digits);

    const relaxedBooking = await this.eligibleAmong(byDigits, identity);

    if (relaxedBooking.length > 0) {
      return this.decide(relaxedBooking);
    }

    /*
     * ── PHASE 3, THE LAST: the booking and the date ──────────────────────────
     * The container rule is dropped entirely — both the container the
     * confirmation names and the provenance test that stands in for it.
     *
     * That is why it is last. A container printed on a confirmation does not
     * reliably identify a Trip: an order placed without one is given a
     * container by hand afterwards, and the confirmation that follows may carry
     * exactly that value. Matching strictly on it refused money that plainly
     * belonged to the Trip.
     *
     * The DATE is not dropped with it. A booking that comes round again on
     * another day is a different transport, and no fallback may reach across
     * it. The booking is still compared exactly first and by digits second, so
     * this phase loosens one thing and one thing only.
     */
    const onDate = (candidates: readonly Trip[]) =>
      candidates.filter((trip) => this.isOnTransportDate(trip, identity));

    const lastByBooking = onDate(exact);

    if (lastByBooking.length > 0) {
      return this.decide(lastByBooking);
    }

    return this.decide(onDate(byDigits));
  }

  /** The count is the answer. Nothing is ever chosen from several. */
  private decide(candidates: readonly Trip[]): CostConfirmationMatch {
    if (candidates.length === 0) {
      return { kind: "NO_MATCHING_TRIP" };
    }

    if (candidates.length > 1) {
      return { kind: "AMBIGUOUS", trips: candidates };
    }

    return { kind: "MATCHED", trip: candidates[0] as Trip };
  }

  /**
   * The Trips among these that the confirmation could be about.
   *
   * The same filter for both phases, which is what keeps the fallback a
   * booking-number rule rather than a second, looser set of criteria.
   */
  private async eligibleAmong(
    candidates: readonly Trip[],
    identity: ConfirmationIdentity,
  ): Promise<Trip[]> {
    const onThatDate = candidates.filter((trip) =>
      this.isOnTransportDate(trip, identity),
    );

    if (identity.containerReference !== null) {
      return onThatDate.filter(
        (trip) =>
          toContainerIdentity(trip.containerNumber) ===
          identity.containerReference,
      );
    }

    const eligible: Trip[] = [];

    for (const trip of onThatDate) {
      if ((await this.originalSourceHadContainer(trip)) === false) {
        eligible.push(trip);
      }
    }

    return eligible;
  }

  /** Whether this Trip was ordered for the date the confirmation states. */
  private isOnTransportDate(
    trip: Trip,
    identity: ConfirmationIdentity,
  ): boolean {
    return (
      trip.originalPlanningDate !== null &&
      toIsoDate(trip.originalPlanningDate) === identity.transportDate
    );
  }

  /**
   * Whether the document this Trip was CREATED from printed a container.
   *
   * ── WHY NOT THE TRIP'S OWN CONTAINER NUMBER ───────────────────────────────
   * A Loading is ordered before anyone knows which container will be picked up,
   * so the order prints none and the operator types one in later. That later
   * edit must not change which confirmations can reach the Trip: a
   * container-less confirmation belongs to a transport that was ORDERED without
   * one, whatever has been recorded since.
   *
   * The evidence is the stored PDF, reached through `pdf_document_id` — the
   * document that created the Trip, which a revision never repoints.
   *
   * ── AND WHY NULL IS REFUSED RATHER THAN GUESSED ───────────────────────────
   * Returns null when the answer cannot be established: no source document, a
   * file that is gone, one that no longer parses, or one naming no trip with
   * this booking. The caller treats that as NOT eligible, so an unreadable
   * source can never let a confirmation attach itself to the wrong Trip.
   */
  private async originalSourceHadContainer(
    trip: Trip,
  ): Promise<boolean | null> {
    if (trip.pdfDocumentId === null || trip.bookingNumber === null) {
      return null;
    }

    try {
      const stored = await this.pdfDocuments.readContent(trip.pdfDocumentId);
      const parsed = await parse(stored.content);

      if (!parsed.ok) {
        this.logger.warn("A Trip's source document no longer parses", {
          tripId: trip.id,
          pdfDocumentId: trip.pdfDocumentId,
          reason: parsed.reason,
        });

        return null;
      }

      /*
       * One document can describe two legs — a Combination prints both — so the
       * booking number says which leg is this Trip's.
       *
       * A document describing exactly ONE trip needs no such choice, and is
       * accepted even when the booking numbers are spelled differently: it is
       * this Trip's own source, and there is nothing else in it to confuse it
       * with.
       */
      const named = parsed.trips.filter(
        (candidate) => candidate.bookingNumber === trip.bookingNumber,
      );

      const source =
        named.length === 1
          ? named[0]
          : parsed.trips.length === 1
            ? parsed.trips[0]
            : null;

      if (source === null) {
        this.logger.warn("A Trip's source document names no matching leg", {
          tripId: trip.id,
          pdfDocumentId: trip.pdfDocumentId,
        });

        return null;
      }

      return source.containerNumber !== null;
    } catch (error: unknown) {
      this.logger.warn("A Trip's source document could not be read", {
        tripId: trip.id,
        pdfDocumentId: trip.pdfDocumentId,
        reason: error instanceof Error ? error.message : String(error),
      });

      return null;
    }
  }
}
