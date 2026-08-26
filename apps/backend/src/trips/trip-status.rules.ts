import { TripStatus } from "@prisma/client";

/**
 * The Trip status state machine.
 *
 * Kept as pure data outside the service so the whole lifecycle is readable in
 * one place and testable without a database, a logger or a repository.
 *
 * Sources — database_model.md §4.1 "Trip Status" and "Lifecycle":
 *   - OPEN is the entry state.
 *   - CLOSED → OPEN is explicitly not allowed.
 *   - CANCELLED is a business cancellation; DELETED is an administrative soft
 *     delete, and the two must never be treated as the same value.
 *   - "Trip reopened" is a recorded event, and the only reopening the document
 *     leaves room for is undoing a cancellation.
 */

/**
 * Statuses a Trip may be moved to through the status endpoint.
 *
 * DELETED is deliberately absent: soft delete and restore are separate
 * operations with their own rules, so the two concerns cannot be confused.
 */
export const CHANGEABLE_TRIP_STATUSES = [
  TripStatus.OPEN,
  TripStatus.CLOSED,
  TripStatus.CANCELLED,
] as const;

export type ChangeableTripStatus = (typeof CHANGEABLE_TRIP_STATUSES)[number];

/**
 * Allowed transitions, keyed by current status.
 *
 * CLOSED is terminal: a pricing result exists from that point on, and reopening
 * would invalidate it. DELETED is left only through restore.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<TripStatus, readonly TripStatus[]>> =
  {
    [TripStatus.OPEN]: [TripStatus.CLOSED, TripStatus.CANCELLED],
    [TripStatus.CLOSED]: [],
    [TripStatus.CANCELLED]: [TripStatus.OPEN],
    [TripStatus.DELETED]: [],
  };

/**
 * The statuses a Trip may be soft-deleted from.
 *
 * ── WHY CANCELLED IS HERE ───────────────────────────────────────────────────
 * A cancelled transport is exactly the kind an operator wants out of the way,
 * and requiring them to reopen it first — CANCELLED → OPEN → DELETED — moved
 * the Trip through a state it was never in, announcing that it was live again
 * on the way past.
 *
 * ── AND WHAT THAT COSTS ─────────────────────────────────────────────────────
 * Restore returns a Trip to OPEN, and the status it held before deletion is
 * recorded nowhere. So a Trip deleted FROM CANCELLED comes back OPEN rather
 * than cancelled. That is a real loss of information, stated here rather than
 * hidden: restoring is an administrator recovering a record, not an undo of the
 * cancellation, and the Trip can be cancelled again in one step.
 *
 * CLOSED is still absent. A closed Trip has been carried out and priced;
 * making it disappear from the planning is not an operational tidy-up.
 */
export const DELETABLE_FROM_STATUSES: readonly TripStatus[] = [
  TripStatus.OPEN,
  TripStatus.CANCELLED,
];

/**
 * The status a restored Trip returns to.
 *
 * OPEN, whatever it was deleted from — see the note above on what that costs.
 */
export const RESTORED_STATUS = TripStatus.OPEN;

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** The transitions available from a status. Used for actionable error messages. */
export function allowedTransitionsFrom(
  from: TripStatus,
): readonly TripStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

/**
 * Statuses that occupy a Vehicle.
 *
 * A cancelled transport releases the vehicle, and a deleted record never held
 * it, so neither may block a new assignment.
 */
export const VEHICLE_OCCUPYING_STATUSES: readonly TripStatus[] = [
  TripStatus.OPEN,
  TripStatus.CLOSED,
];

/**
 * Statuses that hold on to a Booking Number.
 *
 * DELETED is excluded on purpose: the model describes soft delete as the remedy
 * for a Trip that "was created incorrectly or is a duplicate", so the deleted
 * record must not permanently block re-entering the same booking.
 */
export const BOOKING_NUMBER_HOLDING_STATUSES: readonly TripStatus[] = [
  TripStatus.OPEN,
  TripStatus.CLOSED,
  TripStatus.CANCELLED,
];
