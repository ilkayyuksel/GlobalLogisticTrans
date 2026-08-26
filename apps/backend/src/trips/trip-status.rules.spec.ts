import { TripStatus } from "@prisma/client";

import {
  BOOKING_NUMBER_HOLDING_STATUSES,
  CHANGEABLE_TRIP_STATUSES,
  DELETABLE_FROM_STATUSES,
  RESTORED_STATUS,
  VEHICLE_OCCUPYING_STATUSES,
  allowedTransitionsFrom,
  canTransition,
} from "./trip-status.rules";

/**
 * The state machine is tested exhaustively rather than by example: every one of
 * the sixteen ordered pairs is asserted, so a transition can never be added by
 * accident without a test turning red.
 */
describe("Trip status rules", () => {
  const ALL = Object.values(TripStatus);

  const ALLOWED: ReadonlyArray<[TripStatus, TripStatus]> = [
    [TripStatus.OPEN, TripStatus.CLOSED],
    [TripStatus.OPEN, TripStatus.CANCELLED],
    [TripStatus.CANCELLED, TripStatus.OPEN],
  ];

  it.each(ALLOWED)("permits %s to %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("permits nothing else, including every self-transition", () => {
    const permitted = ALL.flatMap((from) =>
      ALL.filter((to) => canTransition(from, to)).map((to) => `${from}->${to}`),
    );

    expect(permitted.sort()).toEqual(
      ALLOWED.map(([from, to]) => `${from}->${to}`).sort(),
    );
  });

  it("treats CLOSED as terminal, as the model states explicitly", () => {
    expect(canTransition(TripStatus.CLOSED, TripStatus.OPEN)).toBe(false);
    expect(allowedTransitionsFrom(TripStatus.CLOSED)).toEqual([]);
  });

  it("never reaches DELETED through a transition", () => {
    // Soft delete is a separate operation with its own precondition.
    for (const from of ALL) {
      expect(canTransition(from, TripStatus.DELETED)).toBe(false);
    }
  });

  it("never leaves DELETED through a transition", () => {
    expect(allowedTransitionsFrom(TripStatus.DELETED)).toEqual([]);
  });

  it("excludes DELETED from the statuses the status endpoint accepts", () => {
    expect(CHANGEABLE_TRIP_STATUSES).not.toContain(TripStatus.DELETED);
    expect([...CHANGEABLE_TRIP_STATUSES].sort()).toEqual(
      [TripStatus.OPEN, TripStatus.CLOSED, TripStatus.CANCELLED].sort(),
    );
  });

  /**
   * ── DELETION AND RESTORE NO LONGER MIRROR EACH OTHER ─────────────────────
   * A cancelled Trip can be deleted directly, because forcing an operator
   * through CANCELLED → OPEN → DELETED moved it through a state it was never
   * in. Restore still has no trip_history to read a previous status from, so
   * it returns every Trip to OPEN.
   *
   * The consequence is deliberate and asserted rather than left implicit: a
   * Trip deleted while CANCELLED comes back OPEN. Restoring is an
   * administrator recovering a record, not an undo of the cancellation.
   * ──────────────────────────────────────────────────────────────────────────
   */
  it("allows deletion from OPEN and from CANCELLED", () => {
    expect([...DELETABLE_FROM_STATUSES].sort()).toEqual(
      [TripStatus.OPEN, TripStatus.CANCELLED].sort(),
    );
  });

  it("never allows deletion of a CLOSED or an already DELETED Trip", () => {
    expect(DELETABLE_FROM_STATUSES).not.toContain(TripStatus.CLOSED);
    expect(DELETABLE_FROM_STATUSES).not.toContain(TripStatus.DELETED);
  });

  it("restores to OPEN, which is one of the statuses it can be deleted from", () => {
    expect(RESTORED_STATUS).toBe(TripStatus.OPEN);
    expect(DELETABLE_FROM_STATUSES).toContain(RESTORED_STATUS);
  });

  it("counts only OPEN and CLOSED Trips as occupying a Vehicle", () => {
    expect([...VEHICLE_OCCUPYING_STATUSES].sort()).toEqual(
      [TripStatus.OPEN, TripStatus.CLOSED].sort(),
    );
    expect(VEHICLE_OCCUPYING_STATUSES).not.toContain(TripStatus.CANCELLED);
    expect(VEHICLE_OCCUPYING_STATUSES).not.toContain(TripStatus.DELETED);
  });

  it("releases the booking number on deletion but not on cancellation", () => {
    expect(BOOKING_NUMBER_HOLDING_STATUSES).toContain(TripStatus.CANCELLED);
    expect(BOOKING_NUMBER_HOLDING_STATUSES).not.toContain(TripStatus.DELETED);
  });
});
