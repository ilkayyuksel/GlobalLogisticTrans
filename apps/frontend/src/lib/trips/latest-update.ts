import type { Trip } from "@/lib/api/types";

/**
 * Which fields the LATEST update document moved.
 *
 * ── WHAT THE YELLOW MEANS ───────────────────────────────────────────────────
 * "The most recent UPDATE changed this field" — and nothing else. It is not a
 * record of everything that was ever touched: when a newer update arrives, the
 * previous update's fields go back to normal, because they are no longer what
 * changed. That distinction is the whole point of the marker, and it is decided
 * by the BACKEND, which reports the change set of the newest applied update.
 * Nothing here compares values or remembers anything between renders.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The names are the backend's own field names, so a field added to the compared
 * set later needs no change here.
 */

/** Fields the Ritten list and the Trip detail can highlight. */
export type UpdatedField =
  | "containerNumber"
  | "containerType"
  | "terminal"
  | "destinationCity"
  | "destinationCountry"
  | "originalPlanningDate"
  | "startTime"
  | "endTime"
  | "direction";

export function changedByLatestUpdate(
  trip: Trip,
  field: UpdatedField,
): boolean {
  return trip.latestUpdate?.changedFields.includes(field) ?? false;
}

/**
 * Whether an operator should be told this Trip was revised.
 *
 * Only while it is OPEN. "Bijgewerkt" describes work still to be done that has
 * changed since it was planned; on a finished or cancelled Trip the lifecycle
 * state is the thing that matters, and a second marker beside it would compete
 * with it for no gain.
 *
 * It is DERIVED, and deliberately not a status: OPEN, CLOSED and CANCELLED are
 * the lifecycle, and adding a fourth would give the state machine a transition
 * that means nothing.
 */
export function isRevised(trip: Trip): boolean {
  return trip.status === "OPEN" && trip.latestUpdate !== null;
}

/**
 * The classes that mark a changed value.
 *
 * A tint plus a left rule, so the marker survives next to a coloured status
 * badge and is still visible to somebody who cannot separate the hue from the
 * background. Tokens only: the same class works in both themes.
 *
 * Deliberately NOT the class the completed row uses — that one washes a whole
 * row to say "this transport is done", and these two must never be mistaken for
 * one another.
 */
export const UPDATED_FIELD_CLASS =
  "bg-warning/15 ring-1 ring-inset ring-warning/40 rounded px-1";
