import { Injectable } from "@nestjs/common";

import {
  DocumentIdentity,
  DocumentTripMatch,
  resolveTripForDocument,
} from "./document-trip-matching";
import { TripIdentity, TripRepository } from "./trip.repository";
import { BOOKING_NUMBER_HOLDING_STATUSES } from "./trip-status.rules";

/**
 * Whether the Trips a transport order names are in the database.
 *
 * Read-only, and it decides nothing new: each question is answered by a rule
 * the Trip domain already applies, exposed so the import can CHECK its result
 * against the same rules that produced it.
 *
 *   `findForDocument`   the document matcher UPDATE and CANCEL use — the whole
 *                       identity first, then booking and date for a document
 *                       that names no usable container
 *   `holdsIdentity`     the exact identity lookup a repeated NEW is applied by
 *                       (`TripRevisionService.applyNewOrder`)
 *
 * Both search the statuses that hold a booking number, so a DELETED Trip never
 * counts as present.
 */
@Injectable()
export class DocumentTripPresenceService {
  constructor(private readonly repository: TripRepository) {}

  findForDocument(identity: DocumentIdentity): Promise<DocumentTripMatch> {
    return resolveTripForDocument(this.repository, identity);
  }

  async holdsIdentity(identity: TripIdentity): Promise<boolean> {
    const holder = await this.repository.findByIdentity({
      identity,
      statuses: BOOKING_NUMBER_HOLDING_STATUSES,
    });

    return holder !== null;
  }
}
