import { Injectable } from "@nestjs/common";

import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { DocumentTripPresenceService } from "../trips/document-trip-presence.service";
import type { TripIdentity } from "../trips/trip.repository";
import { ImportNotPersistedException } from "./exceptions/pdf-import.exceptions";

/**
 * Checks, after the write, that an import left what its document describes.
 *
 * ── WHY A SUCCESSFUL PARSE IS NOT ENOUGH ────────────────────────────────────
 * An import used to count as done when nothing threw. But a document can be
 * read perfectly, written without error, and still not produce its record: a
 * NEW order whose first Trip already existed was applied as a repeat of that
 * Trip, and its OTHER Trip — the second leg, a second container — was never
 * created, while the email was marked processed. So the result is now checked
 * in the database, by the rules that should have produced it:
 *
 *   transport order   every Trip it names is found by the document matcher —
 *                     booking, normalised container and the document's own
 *                     date, then booking and date for a document naming no
 *                     usable container (`DocumentTripPresenceService`)
 *   cost confirmation the Trip it was matched to carries its `cc_number`
 *
 * An ambiguous match counts as present: Trips for that booking and date exist,
 * and choosing between them is not this check's business.
 *
 * A failure raises `ImportNotPersistedException`, an ordinary import failure:
 * the mailbox marks the email FAILED and forwards it once, an upload shows it.
 * Nothing found here is rolled back — what was written is valid on its own.
 */
@Injectable()
export class ImportPersistenceVerifier {
  constructor(
    private readonly presence: DocumentTripPresenceService,
    private readonly costConfirmations: CostConfirmationService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(ImportPersistenceVerifier.name);
  }

  /** Every Trip the transport order names is in the database. */
  async assertTripsPersisted(
    identities: readonly TripIdentity[],
    originalFilename: string,
  ): Promise<void> {
    const missing: TripIdentity[] = [];

    for (const identity of identities) {
      const match = await this.presence.findForDocument(identity);

      if (match.kind === "NO_MATCHING_TRIP") {
        missing.push(identity);
      }
    }

    this.report("transport order", originalFilename, identities, missing);

    if (missing.length > 0) {
      throw new ImportNotPersistedException(
        originalFilename,
        missing.map(describeIdentity),
        "no Trip exists for",
      );
    }
  }

  /**
   * Before a repeated NEW is applied: every Trip it names already exists.
   *
   * A NEW whose identity is taken is applied to the Trips holding it, and that
   * path creates nothing. Checked BEFORE anything is written, by the exact
   * lookup it applies with, so a document naming one Trip we hold and one we
   * do not is refused whole — and its retry on the next scan writes nothing
   * either, instead of storing the document and its history again each time.
   */
  async assertEveryIdentityHeld(
    identities: readonly TripIdentity[],
    originalFilename: string,
  ): Promise<void> {
    const missing: TripIdentity[] = [];

    for (const identity of identities) {
      if (!(await this.presence.holdsIdentity(identity))) {
        missing.push(identity);
      }
    }

    this.report("repeated transport order", originalFilename, identities, missing);

    if (missing.length > 0) {
      throw new ImportNotPersistedException(
        originalFilename,
        missing.map(describeIdentity),
        "it repeats an order we already hold and also names Trips that do not exist, which a repeated order never creates",
      );
    }
  }

  /** The matched Trip carries the confirmation that was just offered. */
  async assertCostConfirmationPersisted(
    confirmation: { readonly ccNumber: string; readonly tripId: string },
    originalFilename: string,
  ): Promise<void> {
    const isRecorded = await this.costConfirmations.isRecordedFor(
      confirmation.tripId,
      confirmation.ccNumber,
    );

    this.logger.log("Import result checked in the database", {
      documentType: "cost confirmation",
      originalFilename,
      ccNumber: confirmation.ccNumber,
      tripId: confirmation.tripId,
      verified: isRecorded,
    });

    if (!isRecorded) {
      throw new ImportNotPersistedException(
        originalFilename,
        [`cost confirmation ${confirmation.ccNumber} on Trip ${confirmation.tripId}`],
        "the confirmation is not recorded on the Trip it was matched to",
      );
    }
  }

  private report(
    documentType: string,
    originalFilename: string,
    identities: readonly TripIdentity[],
    missing: readonly TripIdentity[],
  ): void {
    const details = {
      documentType,
      originalFilename,
      identities: identities.map(describeIdentity),
      missing: missing.map(describeIdentity),
      verified: missing.length === 0,
    };

    if (missing.length > 0) {
      this.logger.warn("Import result missing from the database", details);
    } else {
      this.logger.log("Import result checked in the database", details);
    }
  }
}

/** booking / container / date, the way an operator looks a Trip up. */
function describeIdentity(identity: TripIdentity): string {
  const date = identity.originalPlanningDate?.toISOString().slice(0, 10) ?? "no date";

  return `booking ${identity.bookingNumber}, container ${identity.containerNumber ?? "(none)"}, ${date}`;
}
