import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, TripStatus } from "@prisma/client";

import { aTrip, day, invoiceWorld, type InvoiceWorld } from "./__fixtures__/invoice-world";
import type { InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";

/**
 * Week 41: R53-R54 charge EC 4220981 (EK 110) and EC 4220982 (EK 70) for
 * ANRDUB2812770 on 6 October, stating no container; there is no transport line
 * of it. Its container, PVDU 1106430, is also on R42 — another transport
 * (ANRDUB2813293, to Laakdal) the same day.
 *
 * When R42 could not find its own Trip, its date and container reached
 * ANRDUB2812770's: R42 was either AMBIGUOUS between the two, or "corrected"
 * onto it. Either way ANRDUB2812770 counted as on the invoice and its transport
 * line was never added. A Trip EC lines name by their own booking is no
 * misprint of another line (`toCostLineClaims`).
 */

const TUESDAY = "2026-10-06";
const WEDNESDAY = "2026-10-07";
const COLUMN = { booking: 5, tarief: 12, fuel: 13, ek: 20, remarks: 21 } as const;

const ecLine = (ccNumber: string, ek: number): InvoiceFixtureLine => ({
  planningDate: day(TUESDAY),
  bookingNumber: "ANRDUB2812770",
  containerNumber: "",
  tarief: null,
  ek,
  remarks: `EC ${ccNumber}`,
  containerType: null,
  startPoint: null,
  endPoint: null,
});

/** R42: the Laakdal transport sharing the container. */
const R42: InvoiceFixtureLine = {
  planningDate: day(TUESDAY),
  bookingNumber: "ANRDUB2813293",
  containerNumber: "PVDU 1106430",
  tarief: 229,
  fuel: 34.35,
};

const LINES = [R42, ecLine("4220981", 110), ecLine("4220982", 70)];

describe("a transport its EC lines name is added, however another line shares its container", () => {
  let world: InvoiceWorld;

  beforeEach(() => {
    world = invoiceWorld();
    world.trips.push(aTrip("bousbecque", "ANRDUB2812770", "PVDU1106430", TUESDAY));
    world.confirmations.push(
      { tripId: "bousbecque", ccNumber: "4220981", amount: new Prisma.Decimal(110) },
      { tripId: "bousbecque", ccNumber: "4220982", amount: new Prisma.Decimal(70) },
    );
    world.ekOf.set("bousbecque", "180");
  });

  const addedRow = 5;

  async function expectAddedOnce(lines: readonly InvoiceFixtureLine[] = LINES) {
    const checked = await world.check(lines);
    const { result, cell } = checked;

    // 1. The transport was found on the EC lines' own date and booking.
    expect(result.rows.slice(1).map((row) => [row.status, row.transportTrip?.id, row.trip?.id])).toEqual([
      ["COST_LINE", "bousbecque", "bousbecque"],
      ["COST_LINE", "bousbecque", "bousbecque"],
    ]);
    // 2. Both EC lines kept.
    expect([cell(3, COLUMN.ek).value, cell(4, COLUMN.ek).value]).toEqual([110, 70]);
    expect([cell(3, COLUMN.remarks).value, cell(4, COLUMN.remarks).value]).toEqual(["EC 4220981", "EC 4220982"]);
    // 3, 4, 6. One transport line added: its prices, no EK a second time — in the preview and the written file.
    expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["bousbecque"]);
    expect([cell(addedRow, COLUMN.booking).value, cell(addedRow, COLUMN.tarief).value, cell(addedRow, COLUMN.fuel).value, cell(addedRow, COLUMN.ek).value]).toEqual([
      "ANRDUB2812770",
      200,
      30,
      null,
    ]);
    // 5. The totals grow by its Tarief and Fuel, and by no EK.
    const grew = (column: string) => {
      // The header as the sheet writes it: `Fuel 15%` for Fuel.
      const total = result.totals.columns.find((each) => each.column.startsWith(column))!;

      return new Prisma.Decimal(total.after).minus(total.before).toFixed(2);
    };
    expect([grew("Tarief"), grew("Fuel"), grew("EK")]).toEqual(["200.00", "30.00", "0.00"]);
    expect(result.payments.filter((payment) => payment.tripId === "bousbecque")).toEqual([
      expect.objectContaining({ payable: true, rowNumbers: [3, 4, addedRow] }),
    ]);

    return checked;
  }

  it("with R42's own Trip in Trano exactly: R42 is that Trip, the transport added", async () => {
    world.trips.push(aTrip("laakdal", "ANRDUB2813293", "PVDU1106430", TUESDAY));

    const { result } = await expectAddedOnce();

    expect(result.rows[0]).toMatchObject({ status: "MATCHED", trip: { id: "laakdal" } });
  });

  /** The reproduction: before, R42 was AMBIGUOUS between the two and nothing was added. */
  it("with R42's own Trip on another day: R42 finds it, its date corrected, the transport added", async () => {
    world.trips.push(aTrip("laakdal", "ANRDUB2813293", "PVDU1106430", WEDNESDAY));

    const { result } = await expectAddedOnce();

    expect(result.rows[0]).toMatchObject({
      status: "MATCHED",
      trip: { id: "laakdal" },
      dateCorrection: { tripPlanningDate: WEDNESDAY },
      bookingCorrection: null,
    });
  });

  /**
   * Before, R42 was "corrected" onto ANRDUB2812770 — its booking overwritten —
   * and the transport counted as invoiced. Now R42 is a conflict naming the EC
   * lines, and the transport is held back for that reason, said, not hidden.
   */
  it("with no Trip of R42 in Trano: R42 never becomes the EC lines' transport; a conflict, said", async () => {
    const { result, cell } = await world.check(LINES);

    expect(result.rows[0]).toMatchObject({ status: "CONFLICT", trip: null, bookingCorrection: null });
    expect(result.rows[0].matchProblem).toContain("waarvoor rij 3, 4 EC-kosten aanrekent onder zijn eigen boekingsnummer");
    expect(cell(2, COLUMN.booking).value).toBe("ANRDUB2813293");
    expect(result.payments.filter((payment) => payment.tripId === "bousbecque")).toEqual([
      expect.objectContaining({ payable: false, reasons: ["NO_OWN_LINE", "MATCH_CONFLICT"], blockingRowNumbers: [2] }),
    ]);
  });

  it("7. adds no second transport line when the corrected file is checked again", async () => {
    world.trips.push(aTrip("laakdal", "ANRDUB2813293", "PVDU1106430", TUESDAY));
    const first = await expectAddedOnce();

    const again = await world.checkFile(first.written);

    expect(again.result.missingTrips).toEqual([]);
    expect(again.result.rows.find((row) => row.rowNumber === addedRow)).toMatchObject({ status: "ADDED_MISSING", trip: { id: "bousbecque" } });
  });

  describe("8. and the conditions that rightly keep it off", () => {
    beforeEach(() => {
      world.trips.push(aTrip("laakdal", "ANRDUB2813293", "PVDU1106430", TUESDAY));
    });

    it("a price that cannot be relied on: added without amounts, never paid", async () => {
      world.unreliable.add("bousbecque");

      const { result, cell } = await world.check(LINES);

      expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["bousbecque"]);
      expect(cell(addedRow, COLUMN.tarief).value).toBeNull();
      expect(result.payments.find((payment) => payment.tripId === "bousbecque")).toMatchObject({ payable: false });
    });

    it.each([
      ["already paid", { isPaid: true }],
      ["not finished", { status: TripStatus.OPEN }],
    ])("%s: not added", async (_case, overrides) => {
      world.trips[0] = aTrip("bousbecque", "ANRDUB2812770", "PVDU1106430", TUESDAY, overrides);

      const { result } = await world.check(LINES);

      expect(result.missingTrips).toEqual([]);
    });

    it("planned outside the invoiced week: not added", async () => {
      world.trips[0] = aTrip("bousbecque", "ANRDUB2812770", "PVDU1106430", "2026-10-13");

      const { result } = await world.check(LINES);

      expect(result.missingTrips).toEqual([]);
      expect(result.rows[1].transportTrip).toBeNull();
    });
  });

  /** The real week 41 workbook: R42, R53 and R54 as the customer sent them. */
  it("adds ANRDUB2812770's transport line to the real week 41 invoice", async () => {
    world.trips.push(aTrip("laakdal", "ANRDUB2813293", "PVDU1106430", WEDNESDAY));
    const file = readFileSync(join(__dirname, "../../../../docs/07-excels/week 41 - 2026 GLT.xlsx"));

    const { result } = await world.checkFile(file);

    expect(result.rows.find((row) => row.rowNumber === 42)).toMatchObject({ status: "MATCHED", trip: { id: "laakdal" } });
    expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["bousbecque"]);
    expect(result.payments.find((payment) => payment.tripId === "bousbecque")).toMatchObject({
      payable: true,
      rowNumbers: [53, 54, 128],
    });
  });
});
