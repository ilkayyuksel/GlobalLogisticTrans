import { Prisma } from "@prisma/client";

import { aTrip, day, invoiceWorld, type InvoiceWorld } from "./__fixtures__/invoice-world";
import type { InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";

/**
 * An EC line stating no container: which transport it is about is answered by
 * its date and booking alone (`transportTrip`); which Trip its EK is checked
 * against by its confirmation (`trip`). The EC number never decides the
 * first, and the two are never confused.
 *
 * Booking ANRDUB2812770 has Trip "y" on Tuesday 6 October.
 */

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const BOOKING = "ANRDUB2812770";
const COLUMN = { tarief: 12, ek: 20 } as const;

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

describe("an EC line without container: its transport and its confirmation apart", () => {
  let world: InvoiceWorld;

  beforeEach(() => {
    world = invoiceWorld();
    world.trips.push(aTrip("other", "ANRDUB2810001", "EUCU1000001", TUESDAY));
    world.trips.push(aTrip("y", BOOKING, "EUCU2000001", TUESDAY));
  });

  const confirm = (tripId: string) =>
    world.confirmations.push({ tripId, ccNumber: "4220981", amount: new Prisma.Decimal(110) });

  it("1. date and booking identify one Trip: that is its transport, and its EK is checked on its confirmation of it", async () => {
    confirm("y");

    const { result, cell } = await world.check([otherTransport, ecLine()]);
    const row = result.rows[1];

    expect(row).toMatchObject({ status: "COST_LINE", transportTrip: { id: "y" }, trip: { id: "y" } });
    expect(row.pricingStatus).toBe("MATCHED_NO_CHANGES");
    // Its transport has no line of its own: added once, through the missing transports.
    expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["y"]);
    expect(cell(3, COLUMN.tarief).value).toBeNull();
  });

  it("2. a confirmation of ANOTHER Trip than the line's values identify: nothing chosen, both said, the EK not checked", async () => {
    world.trips.push(aTrip("x", BOOKING, "EUCU2000002", MONDAY));
    confirm("x");

    const { result } = await world.check([otherTransport, ecLine()]);
    const row = result.rows[1];

    expect(row).toMatchObject({ status: "COST_LINE_UNRESOLVED", trip: null, transportTrip: { id: "y" } });
    expect(row.pricingStatus).toBe("NOT_COMPARED");
    expect(row.matchProblem).toBe(
      "Kostenbevestiging EC 4220981 hoort bij rit ANRDUB2812770 · EUCU2000002 · 05/10/2026 · afgewerkt, maar de identificatievelden van deze regel (datum, boekingsnummer, container) wijzen rit ANRDUB2812770 · EUCU2000001 · 06/10/2026 · afgewerkt aan; het EK-bedrag is niet gecontroleerd.",
    );
    // The confirmation did not make "x" the line's transport.
    expect(result.missingTrips.map((missing) => missing.tripId).sort()).toEqual(["x", "y"]);
  });

  it("3. a known confirmation beside an ambiguous transport: no transport chosen, the EK still checked on its confirmation", async () => {
    world.trips.push(aTrip("y2", BOOKING, "EUCU2000003", TUESDAY));
    confirm("y");

    const { result } = await world.check([otherTransport, ecLine()]);
    const row = result.rows[1];

    expect(row).toMatchObject({ status: "COST_LINE", transportTrip: null, trip: { id: "y" } });
    expect(row.pricingStatus).toBe("MATCHED_NO_CHANGES");
  });

  it("4. an unknown confirmation beside a transport the values identify: the transport named, the confirmation said missing", async () => {
    const { result } = await world.check([otherTransport, ecLine()]);
    const row = result.rows[1];

    expect(row).toMatchObject({ status: "COST_LINE_UNRESOLVED", trip: null, transportTrip: { id: "y" } });
    expect(row.matchProblem).toBe(
      "Geen kostenbevestiging gevonden voor EC 4220981. De rit zelf is wel gevonden (ANRDUB2812770 · EUCU2000001 · 06/10/2026 · afgewerkt), maar staat niet als transportregel op deze factuur; hij wordt beoordeeld als ontbrekende rit.",
    );
    expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["y"]);
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
