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
 * ── THE RULE, IN TWO PHASES ─────────────────────────────────────────────────
 * Phase 1 matches the booking number EXACTLY. Only when that finds nothing at
 * all does Phase 2 repeat the same rule with the booking numbers reduced to
 * their digits.
 *
 * The fallback relaxes the BOOKING COMPARISON and nothing else. The date and
 * the container rule apply identically in both phases, because a looser booking
 * match is a different spelling of the same reference — not a licence to attach
 * money to a different day's transport.
 *
 * It is also not an ambiguity resolver. Phase 1 finding several Trips is an
 * ambiguity and stays one; retrying with a looser booking rule could only ever
 * find more.
 *
 * ── THE CONTAINER RULE ──────────────────────────────────────────────────────
 * A confirmation naming a usable container matches only the Trip holding that
 * container. One naming none matches only a Trip whose ORIGINAL transport order
 * printed none either — read from the document the Trip was created from, never
 * from the Trip's current container number, which an operator may have typed in
 * afterwards.
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

    const exact = await this.eligibleAmong(
      await this.trips.findByExactBookingNumber(identity.bookingNumber),
      identity,
    );

    if (exact.length > 0) {
      return this.decide(exact);
    }

    /*
     * PHASE 2. Only reached because the exact booking found NOTHING — never to
     * narrow or to resolve an ambiguity Phase 1 already reported.
     */
    const digits = bookingNumberDigits(identity.bookingNumber);

    if (digits === null) {
      return { kind: "NO_MATCHING_TRIP" };
    }

    return this.decide(
      await this.eligibleAmong(
        await this.trips.findByBookingDigits(digits),
        identity,
      ),
    );
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
    const onThatDate = candidates.filter(
      (trip) =>
        trip.originalPlanningDate !== null &&
        toIsoDate(trip.originalPlanningDate) === identity.transportDate,
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
