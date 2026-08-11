import { TripStatus } from "@prisma/client";

import {
  BOOKING_NUMBER_HOLDING_STATUSES,
  CHANGEABLE_TRIP_STATUSES,
  DELETABLE_FROM_STATUS,
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

  it("only allows deletion from the status restore returns to", () => {
    // Restore has no trip_history to read a previous status from, so these two
    // must stay the same value or restore becomes a guess.
    expect(DELETABLE_FROM_STATUS).toBe(RESTORED_STATUS);
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
