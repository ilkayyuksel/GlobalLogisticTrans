import { Injectable } from "@nestjs/common";
import { PdfDocument, TripHistory } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  TripDocumentAction,
  TripDocumentDto,
  TripDocumentsDto,
} from "./dto/trip-document-response.dto";
import { TripNotFoundException } from "./exceptions/trip.exceptions";
import { TripHistoryEvent } from "./trip-history";
import { TripRepository } from "./trip.repository";

/**
 * Every transport document that concerns one Trip, newest first.
 *
 * ── WHERE THE LIST COMES FROM ───────────────────────────────────────────────
 * Two places, because a Trip relates to its documents in two different ways:
 *
 *   the ORIGINAL order  → `trip.pdfDocumentId`, the document it was created
 *                         from, which is a property of the Trip itself;
 *   every LATER document → the audit trail, where each UPDATE and CANCEL left
 *                         an event pointing at the PDF that caused it.
 *
 * One UPDATE writes one row per changed field, so the events are grouped back
 * into one entry per document — an update that moved two fields is one document
 * with two changed fields, not two documents.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Two queries, whatever the length of the history. Nothing here reads a file:
 * the bytes are fetched through the existing PDF content endpoint, using the id
 * each entry carries.
 */
@Injectable()
export class TripDocumentsService {
  constructor(
    private readonly repository: TripRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripDocumentsService.name);
  }

  async findForTrip(tripId: string): Promise<TripDocumentsDto> {
    const trip = await this.repository.findById(tripId);

    if (!trip) {
      throw new TripNotFoundException(tripId);
    }

    const events = await this.repository.findHistoryForTrip(tripId);
    const items = groupByDocument(events);

    /*
     * The original order goes last: the list reads newest-first, and the
     * document a Trip was created from is by definition the oldest thing that
     * happened to it. A manually created Trip has none, and simply has no such
     * entry rather than an invented one.
     */
    const alreadyListed = items.some(
      (item) => item.pdfDocumentId === trip.pdfDocumentId,
    );

    /*
     * Unless it is already there. A Trip created by an UPDATE has that same
     * document as its source, and listing it twice — once as the event, once as
     * the original order — would suggest two documents arrived when one did.
     */
    if (trip.pdfDocumentId && !alreadyListed) {
      const original = await this.repository.findPdfDocument(trip.pdfDocumentId);

      if (original) {
        items.push(toOriginalEntry(original));
      }
    }

    return { items };
  }
}

/** An event carrying the document it was caused by, as the repository reads it. */
type EventWithDocument = TripHistory & { pdfDocument: PdfDocument | null };

/**
 * One entry per document, in the order the events arrived.
 *
 * Events with no document are skipped: a status change made by hand is part of
 * the audit trail, but it is not a document and this list is about documents.
 */
function groupByDocument(events: readonly EventWithDocument[]): TripDocumentDto[] {
  const byDocument = new Map<string, TripDocumentDto>();

  for (const event of events) {
    const document = event.pdfDocument;
    const action = actionOf(event.eventType);

    if (!document || !action) {
      continue;
    }

    const known = byDocument.get(document.id);

    if (known) {
      known.changedFields.push(...changedFieldsOf(event));

      continue;
    }

    byDocument.set(document.id, {
      pdfDocumentId: document.id,
      action,
      originalFilename: document.originalFilename,
      occurredAt: event.occurredAt,
      changedFields: changedFieldsOf(event),
      outcome: event.description,
      applied: APPLIED_EVENTS.includes(event.eventType),
      createdTrip: event.eventType === TripHistoryEvent.UpdateCreatedTrip,
    });
  }

  return [...byDocument.values()];
}

/**
 * The events that actually moved something.
 *
 * The rest arrived and were recorded without changing the Trip, which is what
 * `applied: false` says. An UPDATE_APPLIED that moved no field is still
 * applied: the document was accepted, and it happened to agree with the Trip.
 */
const APPLIED_EVENTS: readonly string[] = [
  TripHistoryEvent.UpdateApplied,
  TripHistoryEvent.UpdateCreatedTrip,
  TripHistoryEvent.Cancelled,
  TripHistoryEvent.CostConfirmed,
];

function actionOf(eventType: string): TripDocumentAction | null {
  if (
    eventType === TripHistoryEvent.UpdateApplied ||
    eventType === TripHistoryEvent.UpdateRefused ||
    eventType === TripHistoryEvent.UpdateCreatedTrip
  ) {
    return TripDocumentAction.Update;
  }

  if (
    eventType === TripHistoryEvent.Cancelled ||
    eventType === TripHistoryEvent.CancelRedundant ||
    eventType === TripHistoryEvent.CancelRefused
  ) {
    return TripDocumentAction.Cancel;
  }

  /*
   * A NEW document refused because its booking number was still held. It is a
   * NEW order that arrived, and listing it as anything else would misdescribe
   * what the sender sent.
   */
  if (eventType === TripHistoryEvent.NewRefusedDuplicate) {
    return TripDocumentAction.New;
  }

  if (
    eventType === TripHistoryEvent.CostConfirmed ||
    eventType === TripHistoryEvent.CostConfirmationRefused
  ) {
    return TripDocumentAction.CostConfirmation;
  }

  return null;
}

/** The Trip's own source document, which no event describes. */
function toOriginalEntry(document: PdfDocument): TripDocumentDto {
  return {
    pdfDocumentId: document.id,
    action: TripDocumentAction.New,
    originalFilename: document.originalFilename,
    occurredAt: document.uploadedAt,
    changedFields: [],
    outcome: null,
    applied: true,
    createdTrip: true,
  };
}

/**
 * The Trip fields a document moved.
 *
 * Only an APPLIED UPDATE has any: a cancellation records the status it set, and
 * reporting that as a "changed field" would put `status` in a list an operator
 * reads as the fields of their transport order.
 */
function changedFieldsOf(event: EventWithDocument): string[] {
  return event.eventType === TripHistoryEvent.UpdateApplied
    ? fieldsOf(event.newValue)
    : [];
}

/** The field a history row is about: the key of its `newValue` object. */
function fieldsOf(newValue: unknown): string[] {
  if (
    newValue === null ||
    typeof newValue !== "object" ||
    Array.isArray(newValue)
  ) {
    return [];
  }

  return Object.keys(newValue as Record<string, unknown>);
}
