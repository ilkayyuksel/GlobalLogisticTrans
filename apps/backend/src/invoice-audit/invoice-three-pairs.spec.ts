import { Prisma } from "@prisma/client";

import { aTrip, day, invoiceWorld, type InvoiceWorld } from "./__fixtures__/invoice-world";
import type { InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * A line is "not found" only after ALL THREE pairs of its values were tried:
 * date + booking, date + container, booking + container — on every line,
 * whatever its Remarks say, an EC line stating a whole transport included. Its
 * EC number never chooses the Trip.
 *
 * Trano holds t1: ANRDUB2810001 · EUCU1000001 · Tuesday 6 October 2026.
 */

const TUESDAY = "2026-10-06";
const WEDNESDAY = "2026-10-07";
const BOOKING = "ANRDUB2810001";
const CONTAINER = "EUCU1000001";
const COLUMN = { date: 1, booking: 5, container: 6, tarief: 12, remarks: 21 } as const;

type Shape = "transport line" | "transport line naming an EC" | "EC line stating the transport";

function aLine(shape: Shape, date: string, booking: string, container: string): InvoiceFixtureLine {
  const identity = {
    planningDate: date === "" ? "" : day(date),
    bookingNumber: booking,
    containerNumber: container === "" ? "" : `${container.slice(0, 4)} ${container.slice(4)}`,
  };

  if (shape === "EC line stating the transport") {
    // Week 41 R107's shape: an EK and an EC number, no transport detail.
    return { ...identity, tarief: null, ek: 25, remarks: "EC 4224479", containerType: null, startPoint: null, endPoint: null };
  }

  return { ...identity, tarief: 200, fuel: 30, remarks: shape === "transport line" ? "" : "tar,EC 4224479" };
}

describe("a line is not found only after all three pairs of values were tried", () => {
  let world: InvoiceWorld;

  beforeEach(() => {
    world = invoiceWorld();
    world.trips.push(aTrip("t1", BOOKING, CONTAINER, TUESDAY));
  });

  const isRed = (cell: { font?: { color?: { argb?: string } } }) => cell.font?.color?.argb === CORRECTED_TEXT_ARGB;

  const PAIRS: readonly {
    pair: string;
    misprint: "wrong" | "empty";
    line: [date: string, booking: string, container: string];
    corrected: { column: number; value: unknown };
  }[] = [
    { pair: "date + booking", misprint: "wrong", line: [TUESDAY, BOOKING, "EUCU9999999"], corrected: { column: COLUMN.container, value: CONTAINER } },
    { pair: "date + booking", misprint: "empty", line: [TUESDAY, BOOKING, ""], corrected: { column: COLUMN.container, value: CONTAINER } },
    { pair: "date + container", misprint: "wrong", line: [TUESDAY, "ANRDUB2819999", CONTAINER], corrected: { column: COLUMN.booking, value: BOOKING } },
    { pair: "date + container", misprint: "empty", line: [TUESDAY, "", CONTAINER], corrected: { column: COLUMN.booking, value: BOOKING } },
    { pair: "booking + container", misprint: "wrong", line: [WEDNESDAY, BOOKING, CONTAINER], corrected: { column: COLUMN.date, value: day(TUESDAY) } },
    { pair: "booking + container", misprint: "empty", line: ["", BOOKING, CONTAINER], corrected: { column: COLUMN.date, value: TUESDAY } },
  ];
  // An EC line stating no container names a charge, not a transport (`ec-transport-lines.ts`).
  const SHAPES: readonly Shape[] = ["transport line", "transport line naming an EC", "EC line stating the transport"];
  const cases = PAIRS.flatMap((each) =>
    SHAPES.filter((shape) => shape !== "EC line stating the transport" || each.line[2] !== "").map((shape) => ({ ...each, shape })),
  );

  it.each(cases)("$pair finds the Trip on a $shape whose third value is $misprint, and corrects it in red", async (each) => {
    const { result, cell } = await world.check([aLine(each.shape, ...each.line)]);
    const [row] = result.rows;

    expect(row).toMatchObject({ status: "MATCHED", trip: { id: "t1" } });
    expect(cell(2, each.corrected.column).value).toEqual(each.corrected.value);
    expect(isRed(cell(2, each.corrected.column))).toBe(true);
    // Then priced as any transport line: an empty Tarief is filled from Trano.
    expect(cell(2, COLUMN.tarief).value).toBe(200);
    expect(result.missingTrips).toEqual([]);
  });

  it("matches the transport even though its EC confirmation is unknown, and says the two apart", async () => {
    const { result } = await world.check([aLine("EC line stating the transport", TUESDAY, "ANRDUB2819999", CONTAINER)]);

    expect(result.rows[0]).toMatchObject({
      status: "MATCHED",
      trip: { id: "t1" },
      matchProblem: "De transportmatch is geslaagd; voor EC 4224479 is bij deze rit geen kostenbevestiging gevonden.",
    });
  });

  it("is not found only when none of the three pairs finds a Trip, and says all three were tried", async () => {
    const { result } = await world.check([aLine("transport line", WEDNESDAY, "ANRDUB2819999", CONTAINER.replace("1", "7"))]);

    expect(result.rows[0]).toMatchObject({ status: "NOT_FOUND", trip: null });
    expect(result.rows[0].matchProblem).toMatch(
      /^Gecontroleerd: boekingsnummer \+ datum, containernummer \+ datum en boekingsnummer \+ containernummer\./,
    );
  });

  describe("never a guess", () => {
    it("keeps several Trips on one pair ambiguous", async () => {
      world.trips.push(aTrip("t2", BOOKING, "EUCU1000002", TUESDAY));

      const { result } = await world.check([aLine("transport line", TUESDAY, BOOKING, "EUCU9999999")]);

      expect(result.rows[0]).toMatchObject({ status: "AMBIGUOUS", trip: null });
      expect(result.rows[0].candidates.map((trip) => trip.id).sort()).toEqual(["t1", "t2"]);
    });

    it("keeps pairs pointing at different Trips ambiguous", async () => {
      // Date + booking say t1; date + container say t2.
      world.trips.push(aTrip("t2", "ANRDUB2810002", "EUCU1000002", TUESDAY));

      const { result } = await world.check([aLine("transport line", TUESDAY, BOOKING, "EUCU1000002")]);

      expect(result.rows[0].status).toBe("AMBIGUOUS");
    });

    it("never lets an EC number choose between the Trips the transport match found", async () => {
      world.trips.push(aTrip("t2", BOOKING, "EUCU1000002", TUESDAY));
      // The confirmation names t1 — but the line's values fit t1 and t2 alike.
      world.confirmations.push({ tripId: "t1", ccNumber: "4224479", amount: new Prisma.Decimal(25) });

      const { result } = await world.check([aLine("EC line stating the transport", TUESDAY, BOOKING, "EUCU9999999")]);

      expect(result.rows[0]).toMatchObject({ status: "AMBIGUOUS", trip: null });
    });

    it("never gives a Trip another line already is exactly to a second line", async () => {
      const { result } = await world.check([
        aLine("transport line", TUESDAY, BOOKING, CONTAINER),
        aLine("transport line naming an EC", TUESDAY, BOOKING, "EUCU9999999"),
      ]);

      expect(result.rows.map((row) => [row.status, row.trip?.id ?? null])).toEqual([
        ["MATCHED", "t1"],
        ["CONFLICT", null],
      ]);
      expect(result.rows[1].matchProblem).toContain("rij 2");
    });
  });

  it("adds no Trip a pair found, and still adds one no line is about", async () => {
    world.trips.push(aTrip("t9", "ANRDUB2810009", "EUCU1000009", TUESDAY));

    const { result } = await world.check([aLine("transport line naming an EC", WEDNESDAY, BOOKING, CONTAINER)]);

    expect(result.rows[0]).toMatchObject({ status: "MATCHED", trip: { id: "t1" } });
    expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["t9"]);
    expect(result.blockedMissingTrips).toEqual([]);
  });

  it("comes to the same answer whatever the order of the lines, and leaves the received file as it was", async () => {
    world.trips.push(
      aTrip("t2", "ANRDUB2810002", "EUCU1000002", TUESDAY),
      aTrip("t3", "ANRDUB2810003", "EUCU1000003", TUESDAY),
      aTrip("t4", "ANRDUB2810004", "EUCU1000004", TUESDAY),
    );
    const lines = [
      aLine("transport line", TUESDAY, BOOKING, CONTAINER),
      aLine("transport line naming an EC", TUESDAY, "ANRDUB2810002", "EUCU9999992"),
      aLine("EC line stating the transport", TUESDAY, "ANRDUB2819993", "EUCU1000003"),
      aLine("transport line", WEDNESDAY, "ANRDUB2810004", "EUCU1000004"),
    ];
    const byLine = async (ordered: readonly InvoiceFixtureLine[]) => {
      const { result, receivedUnchanged } = await world.check(ordered);

      expect(receivedUnchanged).toBe(true);

      return new Map(result.rows.map((row) => [`${row.bookingNumber}|${row.containerNumber}`, [row.status, row.trip?.id]]));
    };

    const forwards = await byLine(lines);
    const backwards = await byLine([...lines].reverse());

    expect(backwards).toEqual(forwards);
    expect([...forwards.values()].map(([, tripId]) => tripId).sort()).toEqual(["t1", "t2", "t3", "t4"]);
  });
});
