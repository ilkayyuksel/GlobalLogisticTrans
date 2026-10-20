import { TripStatus } from "@prisma/client";

import { isHeldByAnother, surplusTarHolders, validTarHolders, type TarHolder } from "./tar-charge-holders";

/**
 * Who holds a TAR-nummer's automatic charge for the day, from what was read.
 *
 * T0 < T1 < T2 are the moments the snapshots' calculations started.
 */
const T0 = new Date("2026-09-07T08:00:00Z");
const T1 = new Date("2026-09-07T09:00:00Z");
const T2 = new Date("2026-09-07T10:00:00Z");

const holder = (tripId: string, status: TripStatus, calculatedAt: Date): TarHolder => ({
  tripId,
  status,
  calculatedAt,
});

describe("who holds a TAR charge", () => {
  it("is the CLOSED Trip that carries it", () => {
    const holders = [holder("A", TripStatus.CLOSED, T0)];

    expect(isHeldByAnother(holders, "B")).toBe(true);
    expect(isHeldByAnother(holders, "A")).toBe(false);
  });

  /** Reopened: its snapshot is a real charge until something replaces it. */
  it("is still a reopened Trip nobody has replaced", () => {
    expect(isHeldByAnother([holder("A", TripStatus.OPEN, T0)], "B")).toBe(true);
  });

  /**
   * A cancelled Trip brought back: B took the charge while A was cancelled.
   * A's old snapshot is replaced; B keeps it and A never revives it.
   */
  it("is not a non-CLOSED Trip whose charge a later CLOSED Trip replaced", () => {
    const holders = [holder("A", TripStatus.OPEN, T0), holder("B", TripStatus.CLOSED, T1)];

    expect(validTarHolders(holders).map((each) => each.tripId)).toEqual(["B"]);
    expect(isHeldByAnother(holders, "B")).toBe(false);
    expect(isHeldByAnother(holders, "A")).toBe(true);
  });

  it("keeps a reopened Trip's charge against a CLOSED one priced earlier", () => {
    const holders = [holder("B", TripStatus.CLOSED, T0), holder("A", TripStatus.OPEN, T1)];

    expect(validTarHolders(holders).map((each) => each.tripId).sort()).toEqual(["A", "B"]);
  });

  describe("two CLOSED holders at once", () => {
    it("keeps the first priced and gives up every other", () => {
      const holders = [
        holder("C", TripStatus.CLOSED, T2),
        holder("A", TripStatus.CLOSED, T0),
        holder("B", TripStatus.CLOSED, T1),
      ];

      expect(surplusTarHolders(holders)).toEqual(["B", "C"]);
    });

    it("breaks a tie by Trip id, the same way every time", () => {
      const holders = [holder("B", TripStatus.CLOSED, T0), holder("A", TripStatus.CLOSED, T0)];

      expect(surplusTarHolders(holders)).toEqual(["B"]);
      expect(surplusTarHolders([...holders].reverse())).toEqual(["B"]);
    });

    it("gives up nothing when one Trip, or none, holds it", () => {
      expect(surplusTarHolders([])).toEqual([]);
      expect(surplusTarHolders([holder("A", TripStatus.CLOSED, T0)])).toEqual([]);
      // A reopened holder is no CLOSED Trip to reprice.
      expect(surplusTarHolders([holder("A", TripStatus.OPEN, T0), holder("B", TripStatus.OPEN, T1)])).toEqual([]);
    });
  });
});
