import { Trip } from "@prisma/client";

import { toIsoDate } from "../common/dates";
import { toClockTime } from "../common/time-of-day";
import { ImportedTripData } from "./import-trips.command";

/**
 * What a later document did to a Trip, and which fields it moved.
 *
 * ── WHY THE CHANGE SET IS COMPUTED, NOT REMEMBERED ──────────────────────────
 * Every UPDATE is compared against the Trip AS IT IS at that moment — never
 * against the original NEW document. Three consecutive UPDATEs therefore each
 * get their own answer, and a value that goes ABC → XYZ → ABC counts as changed
 * twice, because both times the document said something the Trip did not.
 * Comparing against the original would call the second one "no change", which
 * is exactly the wrong thing to tell an operator.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── WHAT IS COMPARED ────────────────────────────────────────────────────────
 * The parser-controlled fields an operator actually reads. `parserMetadata` is
 * parser-controlled and IS written by a revision, but it is deliberately absent
 * from the comparison: it is raw diagnostic text that shifts whenever any value
 * on the page shifts, it is displayed nowhere, and reporting it as a change
 * would leave a field highlighted that nobody can see.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The event vocabulary.
 *
 * Plain strings because `trip_history.event_type` is deliberately text — the
 * model says a new event type must not need a migration.
 */
export const TripHistoryEvent = {
  /** An UPDATE document was applied. One row per changed field. */
  UpdateApplied: "UPDATE_APPLIED",
  /** An UPDATE document arrived, was stored, and could not be applied. */
  UpdateRefused: "UPDATE_REFUSED",
  /**
   * An UPDATE document CREATED this Trip, because no Trip held its booking
   * number. Deliberately not an applied update: there was no earlier state to
   * change, so there is no change set and nothing was "updated".
   */
  UpdateCreatedTrip: "UPDATE_CREATED_TRIP",
  /** A CANCEL document moved this Trip to CANCELLED. */
  Cancelled: "CANCELLED",
  /** A CANCEL document arrived for a Trip that was already cancelled. */
  CancelRedundant: "CANCEL_REDUNDANT",
  /** A CANCEL document arrived for a CLOSED Trip. Finished work is not undone. */
  CancelRefused: "CANCEL_REFUSED",
  /** A NEW document arrived for a booking number this Trip still holds. */
  NewRefusedDuplicate: "NEW_REFUSED_DUPLICATE",
  /** Eucon confirmed a cost for this Trip. Changes nothing about the Trip. */
  CostConfirmed: "COST_CONFIRMED",
  /** A second, different confirmation arrived. The first one stands. */
  CostConfirmationRefused: "COST_CONFIRMATION_REFUSED",
} as const;

export type TripHistoryEvent =
  (typeof TripHistoryEvent)[keyof typeof TripHistoryEvent];

/** Events that describe an UPDATE document, whether or not it was applied. */
export const UPDATE_EVENTS: readonly string[] = [
  TripHistoryEvent.UpdateApplied,
  TripHistoryEvent.UpdateRefused,
];

/**
 * Written by the system rather than by a person.
 *
 * `performed_by` holds an Auth0 subject for operator actions; a document that
 * arrived by itself has no subject, and inventing one would attribute the
 * change to somebody who never made it.
 */
export const SYSTEM_ACTOR = "system:pdf-import";

/** The fields a document may change, and that an operator can see. */
export const COMPARED_FIELDS = [
  "containerNumber",
  "containerType",
  "terminal",
  "destinationCity",
  "destinationCountry",
  "originalPlanningDate",
  "startTime",
  "endTime",
  "direction",
] as const;

export type ComparedField = (typeof COMPARED_FIELDS)[number];

/** One field the document moved, in the form the history row stores. */
export interface FieldChange {
  readonly field: ComparedField;
  readonly previousValue: string | null;
  readonly newValue: string | null;
}

/**
 * The fields where the document disagrees with the Trip as it stands.
 *
 * Values are compared in their DISPLAY form — an ISO date, an `HH:mm` clock
 * time — so that a Date object and the string a document carries can be
 * compared at all, and so the stored history reads as what the operator saw.
 */
export function detectFieldChanges(
  trip: Trip,
  document: ImportedTripData,
): FieldChange[] {
  const incoming = toComparableDocument(document);
  const current = toComparableTrip(trip);

  return COMPARED_FIELDS.filter(
    (field) => current[field] !== incoming[field],
  ).map((field) => ({
    field,
    previousValue: current[field],
    newValue: incoming[field],
  }));
}

type Comparable = Record<ComparedField, string | null>;

function toComparableTrip(trip: Trip): Comparable {
  return {
    containerNumber: trip.containerNumber,
    containerType: trip.containerType,
    terminal: trip.terminal,
    destinationCity: trip.destinationCity,
    destinationCountry: trip.destinationCountry,
    originalPlanningDate: trip.originalPlanningDate
      ? toIsoDate(trip.originalPlanningDate)
      : null,
    startTime: toMinutes(trip.startTime ? toClockTime(trip.startTime) : null),
    endTime: toMinutes(trip.endTime ? toClockTime(trip.endTime) : null),
    direction: trip.direction,
  };
}

function toComparableDocument(document: ImportedTripData): Comparable {
  return {
    containerNumber: document.containerNumber,
    containerType: document.containerType,
    terminal: document.terminal,
    destinationCity: document.destinationCity,
    destinationCountry: document.destinationCountry,
    // The document's own date, which is what original_planning_date holds.
    originalPlanningDate: document.planningDate,
    startTime: toMinutes(document.startTime),
    endTime: toMinutes(document.endTime),
    direction: document.direction,
  };
}

/**
 * A clock time to the minute.
 *
 * A stored TIME comes back as `10:00:00` and a document states `10:00`. They
 * are the same moment, and comparing them as text would report a change on
 * every single update — of two fields that nobody touched. Transport orders are
 * planned to the minute, so seconds carry no meaning to compare.
 */
function toMinutes(clockTime: string | null): string | null {
  return clockTime === null ? null : clockTime.slice(0, "HH:MM".length);
}

/** A readable one-line summary, for a person reading the audit trail. */
export function describeChange(change: FieldChange): string {
  return `${change.field}: ${change.previousValue ?? "—"} → ${change.newValue ?? "—"}`;
}
