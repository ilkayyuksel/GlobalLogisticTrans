import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, TripStatus } from "@prisma/client";

import { aTrip, day, invoiceWorld, type InvoiceWorld } from "./__fixtures__/invoice-world";
import type { InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";

/**
 * Week 41: R53-R54 charge EC 4220981 (EK 110) and EC 4220982 (EK 70) for
 * ANRDUB2812770 on 6 October, stating no container; there is no other line of
 * that transport. Its container, PVDU 1106430, is also on R42 — another
 * transport (ANRDUB2813293, to Laakdal) the same day.
 *
 *   * R53-R54 are the transport's line (owner, October 2026): matched on their
 *     date and booking — never their EC numbers — one transport over the two
 *     rows, its prices filled on R53, the EK of both rows compared once.
 *   * R42 never becomes that transport through the container it shares: a Trip
 *     EC lines name by their own booking is no misprint of R42's booking
 *     (`toCostLineClaims`).
 */

const TUESDAY = "2026-10-06";
const WEDNESDAY = "2026-10-07";
const COLUMN = { booking: 5, container: 6, tarief: 12, fuel: 13, ek: 20, remarks: 21 } as const;

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

describe("EC lines with no transport line of theirs are that transport's line, however another line shares its container", () => {
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

  async function expectPricedOnTheEcLines(lines: readonly InvoiceFixtureLine[] = LINES) {
    const checked = await world.check(lines);
    const { result, cell } = checked;

    // Matched on their own date and booking: one transport over both rows.
    expect(result.rows.slice(1).map((row) => [row.status, row.trip?.id, row.sharedKeyRowNumbers])).toEqual([
      ["MATCHED", "bousbecque", [4]],
      ["MATCHED", "bousbecque", [3]],
    ]);
    // Its prices filled once, on the first; its container filled in red on both.
    expect([cell(3, COLUMN.tarief).value, cell(3, COLUMN.fuel).value]).toEqual([200, 30]);
    expect([cell(4, COLUMN.tarief).value, cell(4, COLUMN.fuel).value]).toEqual([null, null]);
    expect([cell(3, COLUMN.container).value, cell(4, COLUMN.container).value]).toEqual(["PVDU1106430", "PVDU1106430"]);
    // Both EC charges kept: 110 + 70 is the transport's EK of 180, unchanged.
    expect([cell(3, COLUMN.ek).value, cell(4, COLUMN.ek).value]).toEqual([110, 70]);
    expect([cell(3, COLUMN.remarks).value, cell(4, COLUMN.remarks).value]).toEqual(["EC 4220981", "EC 4220982"]);
    expect(result.rows[1].comparisons.find((comparison) => comparison.component === "EK")).toMatchObject({
      outcome: "UNCHANGED",
      excelValue: "180.00",
    });
    // The totals grow by its Tarief and Fuel, and by no EK.
    const grew = (column: string) => {
      // The header as the sheet writes it: `Fuel 15%` for Fuel.
      const total = result.totals.columns.find((each) => each.column.startsWith(column))!;

      return new Prisma.Decimal(total.after).minus(total.before).toFixed(2);
    };
    expect([grew("Tarief"), grew("Fuel"), grew("EK")]).toEqual(["200.00", "30.00", "0.00"]);
    // Nothing added beside them.
    expect(result.missingTrips).toEqual([]);
    expect(result.payments.filter((payment) => payment.tripId === "bousbecque")).toEqual([
      expect.objectContaining({ payable: true, rowNumbers: [3, 4] }),
    ]);

    return checked;
  }

  it("with R42's own Trip in Trano exactly: R42 is that Trip, R53-R54 priced", async () => {
    world.trips.push(aTrip("laakdal", "ANRDUB2813293", "PVDU1106430", TUESDAY));

    const { result } = await expectPricedOnTheEcLines();

    expect(result.rows[0]).toMatchObject({ status: "MATCHED", trip: { id: "laakdal" } });
  });

  /** Before: R42 was AMBIGUOUS between the two, and the transport was never priced. */
  it("with R42's own Trip on another day: R42 finds it, its date corrected, R53-R54 priced", async () => {
    world.trips.push(aTrip("laakdal", "ANRDUB2813293", "PVDU1106430", WEDNESDAY));

    const { result } = await expectPricedOnTheEcLines();

    expect(result.rows[0]).toMatchObject({
      status: "MATCHED",
      trip: { id: "laakdal" },
      dateCorrection: { tripPlanningDate: WEDNESDAY },
      bookingCorrection: null,
    });
  });

  /**
   * Before: R42 was "corrected" onto ANRDUB2812770, its booking overwritten.
   * Now R42 is a conflict naming the EC lines; the transport is held back for
   * that reason, said, not hidden.
   */
  it("with no Trip of R42 in Trano: R42 never becomes that transport; a conflict, said", async () => {
    const { result, cell } = await world.check(LINES);

    expect(result.rows[0]).toMatchObject({ status: "CONFLICT", trip: null, bookingCorrection: null });
    expect(result.rows[0].matchProblem).toContain("waarvoor rij 3, 4 EC-kosten aanrekent onder zijn eigen boekingsnummer");
    expect(cell(2, COLUMN.booking).value).toBe("ANRDUB2813293");
    expect(result.payments.find((payment) => payment.tripId === "bousbecque")).toMatchObject({
      payable: false,
      reasons: expect.arrayContaining(["MATCH_CONFLICT"]),
      blockingRowNumbers: [2],
    });
  });

  it("changes nothing more when the corrected file is checked again", async () => {
    world.trips.push(aTrip("laakdal", "ANRDUB2813293", "PVDU1106430", TUESDAY));
    const first = await expectPricedOnTheEcLines();

    const again = await world.checkFile(first.written);

    expect(again.result.missingTrips).toEqual([]);
    expect(again.result.rows.slice(1).map((row) => [row.status, row.pricingStatus, row.remarks])).toEqual([
      ["MATCHED", "MATCHED_NO_CHANGES", null],
      ["MATCHED", "MATCHED_NO_CHANGES", null],
    ]);
  });

  describe("and what it still never does", () => {
    beforeEach(() => {
      world.trips.push(aTrip("laakdal", "ANRDUB2813293", "PVDU1106430", TUESDAY));
    });

    it("invents no price that cannot be relied on, and settles nothing", async () => {
      world.unreliable.add("bousbecque");

      const { result, cell } = await world.check(LINES);

      expect(result.rows[1]).toMatchObject({ status: "MATCHED", pricingStatus: "PRICE_UNRELIABLE" });
      expect(cell(3, COLUMN.tarief).value).toBeNull();
      expect(result.payments.find((payment) => payment.tripId === "bousbecque")).toMatchObject({ payable: false });
    });

    it("prices no unfinished transport", async () => {
      world.trips[0] = aTrip("bousbecque", "ANRDUB2812770", "PVDU1106430", TUESDAY, { status: TripStatus.OPEN });

      const { result, cell } = await world.check(LINES);

      expect(result.rows.slice(1).map((row) => row.status)).toEqual(["NOT_FINISHED", "NOT_FINISHED"]);
      expect(cell(3, COLUMN.tarief).value).toBeNull();
    });

    it("leaves EC lines whose values find no transport the EC charges they are", async () => {
      world.trips[0] = aTrip("bousbecque", "ANRDUB2812770", "PVDU1106430", "2026-10-13");

      const { result, cell } = await world.check(LINES);

      expect(result.rows.slice(1).map((row) => row.status)).toEqual(["COST_LINE", "COST_LINE"]);
      expect(cell(3, COLUMN.tarief).value).toBeNull();
      expect(result.missingTrips).toEqual([]);
    });
  });

  /** The real week 41 workbook: R42, R53 and R54 as the customer sent them. */
  it("prices ANRDUB2812770 on R53 of the real week 41 invoice", async () => {
    world.trips.push(aTrip("laakdal", "ANRDUB2813293", "PVDU1106430", WEDNESDAY));
    const file = readFileSync(join(__dirname, "../../../../docs/07-excels/week 41 - 2026 GLT.xlsx"));

    const { result, cell } = await world.checkFile(file);

    expect(result.rows.find((row) => row.rowNumber === 42)).toMatchObject({ status: "MATCHED", trip: { id: "laakdal" } });
    expect(result.rows.filter((row) => [53, 54].includes(row.rowNumber)).map((row) => [row.status, row.trip?.id])).toEqual([
      ["MATCHED", "bousbecque"],
      ["MATCHED", "bousbecque"],
    ]);
    expect(cell(53, COLUMN.tarief).value).toBe(200);
    expect(result.missingTrips.map((missing) => missing.tripId)).not.toContain("bousbecque");
    expect(result.payments.find((payment) => payment.tripId === "bousbecque")).toMatchObject({
      payable: true,
      rowNumbers: [53, 54],
    });
  });
});
