import { Prisma } from "@prisma/client";

import { aTrip, day, invoiceWorld, type InvoiceWorld } from "./__fixtures__/invoice-world";
import type { InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";

/**
 * An EC line stating no container (week 41 R53's shape). Which transport it is
 * about is answered by its date and booking alone — never by its EC number.
 * When the transport has no line of its own on the invoice, the EC line IS its
 * line (owner, October 2026): matched as a transport line, its prices filled.
 * Whether its confirmation is known is checked apart and said apart.
 *
 * Booking ANRDUB2812770 has Trip "y" on Tuesday 6 October.
 */

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const BOOKING = "ANRDUB2812770";
const COLUMN = { tarief: 12, fuel: 13, ek: 20 } as const;

/** Week 41 R53's shape: a day, a booking, an EK and `EC <nr>`. */
function ecLine(ccNumber = "4220981"): InvoiceFixtureLine {
  return {
    planningDate: day(TUESDAY),
    bookingNumber: BOOKING,
    containerNumber: "",
    tarief: null,
    ek: 110,
    remarks: `EC ${ccNumber}`,
    containerType: null,
    startPoint: null,
    endPoint: null,
  };
}

/** Another transport of the week, so the invoice has a period. */
const otherTransport: InvoiceFixtureLine = {
  planningDate: day(TUESDAY),
  bookingNumber: "ANRDUB2810001",
  containerNumber: "EUCU 1000001",
  tarief: 200,
  fuel: 30,
};

describe("an EC line without container: its transport by its own values, its confirmation apart", () => {
  let world: InvoiceWorld;

  beforeEach(() => {
    world = invoiceWorld();
    world.trips.push(aTrip("other", "ANRDUB2810001", "EUCU1000001", TUESDAY));
    world.trips.push(aTrip("y", BOOKING, "EUCU2000001", TUESDAY));
  });

  const confirm = (tripId: string) =>
    world.confirmations.push({ tripId, ccNumber: "4220981", amount: new Prisma.Decimal(110) });

  it("1. date and booking identify one Trip with no line of its own: the EC line is its line, priced", async () => {
    confirm("y");
    world.ekOf.set("y", "110");

    const { result, cell } = await world.check([otherTransport, ecLine()]);
    const row = result.rows[1];

    expect(row).toMatchObject({ status: "MATCHED", trip: { id: "y" }, matchProblem: null, transportPricesFilled: true });
    expect([cell(3, COLUMN.tarief).value, cell(3, COLUMN.fuel).value, cell(3, COLUMN.ek).value]).toEqual([200, 30, 110]);
    expect(result.missingTrips).toEqual([]);
  });

  it("2. a confirmation of ANOTHER Trip changes nothing about the transport: matched on its values, the confirmation said missing", async () => {
    world.trips.push(aTrip("x", BOOKING, "EUCU2000002", MONDAY));
    confirm("x");

    const { result } = await world.check([otherTransport, ecLine()]);
    const row = result.rows[1];

    expect(row).toMatchObject({
      status: "MATCHED",
      trip: { id: "y" },
      matchProblem: "De transportmatch is geslaagd; voor EC 4220981 is bij deze rit geen kostenbevestiging gevonden.",
    });
    // "x", the confirmation's Trip, has no line of its own: it is missing, not "y".
    expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["x"]);
  });

  it("3. a known confirmation beside an ambiguous transport: the EC number chooses nothing", async () => {
    world.trips.push(aTrip("y2", BOOKING, "EUCU2000003", TUESDAY));
    confirm("y");

    const { result, cell } = await world.check([otherTransport, ecLine()]);
    const row = result.rows[1];

    expect(row).toMatchObject({ status: "AMBIGUOUS", trip: null });
    expect(row.candidates.map((trip) => trip.id).sort()).toEqual(["y", "y2"]);
    expect(cell(3, COLUMN.tarief).value).toBeNull();
  });

  it("4. an unknown confirmation beside a transport the values identify: matched and priced, the confirmation said missing", async () => {
    const { result, cell } = await world.check([otherTransport, ecLine()]);
    const row = result.rows[1];

    expect(row).toMatchObject({
      status: "MATCHED",
      trip: { id: "y" },
      matchProblem: "De transportmatch is geslaagd; voor EC 4220981 is bij deze rit geen kostenbevestiging gevonden.",
    });
    expect(cell(3, COLUMN.tarief).value).toBe(200);
    expect(result.missingTrips).toEqual([]);
  });

  it("5. a stand-alone EC line beside its transport's own line: only its EK compared, no transport price on it, nothing added", async () => {
    confirm("y");

    const transportLine: InvoiceFixtureLine = {
      planningDate: day(TUESDAY),
      bookingNumber: BOOKING,
      containerNumber: "EUCU 2000001",
      tarief: 200,
      fuel: 30,
    };
    const { result, cell } = await world.check([otherTransport, transportLine, ecLine()]);

    expect(result.rows.slice(1).map((row) => [row.status, row.trip?.id, row.transportTrip?.id ?? null])).toEqual([
      ["MATCHED", "y", null],
      ["COST_LINE", "y", "y"],
    ]);
    // Compared on its EK alone, which agrees: no transport component on this row.
    expect(result.rows[2].pricingStatus).toBe("MATCHED_NO_CHANGES");
    expect(result.rows[2].comparisons.filter((comparison) => comparison.component !== "EK")).toEqual([]);
    expect([cell(4, COLUMN.tarief).value, cell(4, COLUMN.ek).value]).toEqual([null, 110]);
    expect(result.missingTrips).toEqual([]);
    expect(result.payments.filter((payment) => payment.tripId === "y")).toEqual([
      expect.objectContaining({ payable: true, rowNumbers: [3, 4] }),
    ]);
  });
});
