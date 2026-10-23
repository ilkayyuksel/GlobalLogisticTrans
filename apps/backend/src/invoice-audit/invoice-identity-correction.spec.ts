import ExcelJS from "exceljs";
import { Prisma, Trip, TripStatus } from "@prisma/client";

import { toIsoDate } from "../common/dates";
import { AppLoggerService } from "../logger/app-logger.service";
import type { CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { reliablyPriced } from "./__fixtures__/invoice-pricing";
import { invoiceReads } from "./__fixtures__/invoice-reads";
import { tripRecord } from "./__fixtures__/invoice-rows";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * Finding the Trip of an invoice line whose date, booking OR container is
 * misprinted — and correcting that one value in the Excel — through the whole
 * check: the matching, the corrected workbook read back from its bytes, the
 * missing transports, the payments and the warnings a person reads.
 *
 * The database is a list of Trips every read FILTERS, so a line can only find
 * what a real query would return. Week 41: Monday 5 to Friday 9 October 2026.
 */

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const WEDNESDAY = "2026-10-07";
const COLUMN = { date: 1, booking: 5, container: 6, tarief: 12, fuel: 13 } as const;

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function aTrip(id: string, booking: string, container: string, date: string, overrides: Partial<Trip> = {}): Trip {
  return tripRecord({
    id,
    bookingNumber: booking,
    containerNumber: container,
    planningDate: day(date),
    originalPlanningDate: day(date),
    startTime: null,
    ...overrides,
  });
}

/** A transport line as the customer writes it: the date as a real date cell. */
function line(date: string, booking: string, container: string, tarief = 200): InvoiceFixtureLine {
  return {
    planningDate: day(date),
    bookingNumber: booking,
    containerNumber: `${container.slice(0, 4)} ${container.slice(4)}`,
    tarief,
    fuel: tarief * 0.15,
  };
}

describe("an invoice line with one misprinted value", () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;
  let database: Trip[];
  let confirmations: { tripId: string; ccNumber: string; amount: Prisma.Decimal }[];
  /** A Trip's stored EK, when it has one. */
  let ekOf: Map<string, string>;

  beforeEach(() => {
    database = [];
    confirmations = [];
    ekOf = new Map();
  });

  const onDay = (trip: Trip, days: readonly Date[]) =>
    days.some((each) => [trip.planningDate, trip.originalPlanningDate].some((date) => date?.getTime() === each.getTime()));
  const alive = (trip: Trip) => trip.status !== TripStatus.DELETED;

  function service() {
    const reads = invoiceReads();
    const pricing = new Map<string, CurrentTripPricing>(
      database.map((trip) => [trip.id, priced("200", "30", ekOf.get(trip.id))]),
    );

    reads.findCostConfirmationsByNumbers.mockImplementation(async (numbers) =>
      confirmations.filter((confirmation) => numbers.includes(confirmation.ccNumber)),
    );
    reads.findTripsByIds.mockImplementation(async (ids) => database.filter((trip) => ids.includes(trip.id)));
    reads.findTripsOnDates.mockImplementation(async (days) => database.filter((trip) => alive(trip) && onDay(trip, days)));
    reads.findTripsByBookings.mockImplementation(async (bookings) =>
      database.filter((trip) => alive(trip) && bookings.includes(trip.bookingNumber!)),
    );

    return buildInvoiceAuditService({
      logger,
      reads,
      trips: {
        findManyForInvoice: jest.fn(async (query: { invoiceDates: Date[]; bookingNumbers: string[]; statuses: TripStatus[] }) =>
          database.filter(
            (trip) =>
              query.statuses.includes(trip.status) &&
              query.bookingNumbers.includes(trip.bookingNumber!) &&
              onDay(trip, query.invoiceDates),
          ),
        ),
        findClosedUnpaidBetween: jest.fn(async ({ from, to }: { from: Date; to: Date }) =>
          database.filter(
            (trip) =>
              trip.status === TripStatus.CLOSED &&
              !trip.isPaid &&
              trip.planningDate! >= from &&
              trip.planningDate! <= to,
          ),
        ),
      },
      effectivePricing: {
        findForTrips: jest.fn(async (ids: readonly string[]) =>
          new Map(ids.filter((id) => pricing.has(id)).map((id) => [id, pricing.get(id)!])),
        ),
      },
    });
  }

  async function check(lines: readonly InvoiceFixtureLine[]) {
    const received = await buildInvoiceWorkbook({ lines, fuelPercentage: 15 });
    const copy = Buffer.from(received);
    const applied = await service().apply({ buffer: received, originalname: "week 41 - 2026 GLT.xlsx", size: received.length });
    const book = new ExcelJS.Workbook();

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    const sheet = book.worksheets[0];

    return {
      result: applied.result,
      rows: applied.result.rows,
      cell: (row: number, column: number) => sheet.getRow(row).getCell(column),
      receivedUnchanged: received.equals(copy),
    };
  }

  const isRed = (cell: ExcelJS.Cell) => cell.font?.color?.argb === CORRECTED_TEXT_ARGB;

  it("matches the three values exactly and corrects nothing", async () => {
    database.push(aTrip("t1", "ANRDUB2813025", "EUCU4590355", TUESDAY));

    const { rows, cell } = await check([line(TUESDAY, "ANRDUB2813025", "EUCU4590355")]);

    expect(rows[0]).toMatchObject({
      status: "MATCHED",
      trip: { id: "t1" },
      dateCorrection: null,
      bookingCorrection: null,
      containerCorrection: null,
      matchProblem: null,
    });
    expect(isRed(cell(2, COLUMN.date))).toBe(false);
  });

  describe("exactly one Trip shares the two other values", () => {
    it("a wrong booking: matched on date and container, the booking corrected in red", async () => {
      database.push(aTrip("t1", "ANRDUB2813025", "EUCU4590355", TUESDAY));

      const { rows, cell } = await check([line(TUESDAY, "ANRDUB2813999", "EUCU4590355")]);

      expect(rows[0]).toMatchObject({
        status: "MATCHED",
        trip: { id: "t1" },
        bookingCorrection: { invoiceBookingNumber: "ANRDUB2813999", tripBookingNumber: "ANRDUB2813025" },
      });
      expect(cell(2, COLUMN.booking).value).toBe("ANRDUB2813025");
      expect(isRed(cell(2, COLUMN.booking))).toBe(true);
      // A match: no extra explanation beside its correction.
      expect(rows[0].matchProblem).toBeNull();
    });

    it("a wrong date: matched on booking and container, the date corrected in red, as a date", async () => {
      database.push(aTrip("t1", "ANRDUB2811064", "EUCU4590355", WEDNESDAY));

      const { rows, cell } = await check([line(TUESDAY, "ANRDUB2811064", "EUCU4590355")]);

      expect(rows[0]).toMatchObject({
        status: "MATCHED",
        trip: { id: "t1" },
        dateCorrection: { invoicePlanningDate: TUESDAY, tripPlanningDate: WEDNESDAY },
      });
      expect(cell(2, COLUMN.date).value).toBeInstanceOf(Date);
      expect(toIsoDate(cell(2, COLUMN.date).value as Date)).toBe(WEDNESDAY);
      expect(isRed(cell(2, COLUMN.date))).toBe(true);
      expect(rows[0].matchProblem).toBeNull();
    });

    it("a wrong container: matched on date and booking, the container corrected in red", async () => {
      database.push(aTrip("t1", "ANRDUB2813025", "EUCU4590355", TUESDAY));

      const { rows, cell } = await check([line(TUESDAY, "ANRDUB2813025", "EUCU9999999")]);

      expect(rows[0]).toMatchObject({ status: "MATCHED", containerCorrection: { tripContainerNumber: "EUCU4590355" } });
      expect(cell(2, COLUMN.container).value).toBe("EUCU4590355");
      expect(isRed(cell(2, COLUMN.container))).toBe(true);
      expect(rows[0].matchProblem).toBeNull();
    });

    it("keeps the price check: a matched line is compared and raised as any other", async () => {
      database.push(aTrip("t1", "ANRDUB2811064", "EUCU4590355", WEDNESDAY));

      const { rows, cell } = await check([line(TUESDAY, "ANRDUB2811064", "EUCU4590355", 150)]);

      expect(rows[0].pricingStatus).toBe("PRICING_CORRECTED");
      expect(cell(2, COLUMN.tarief).value).toBe(200);
      expect(isRed(cell(2, COLUMN.tarief))).toBe(true);
    });
  });

  /**
   * Example A (ANRDUB2813025 against row 57): two lines of one booking on one
   * day. Row 2 is exactly Trip t1. Row 3 states the same day but another
   * container, which is t2's — and t2 ran the day after. Before, row 3 was
   * "corrected" onto t1, collided with row 2 and became a conflict; t2 was then
   * offered as "not added, perhaps already on the invoice".
   */
  describe("example A: a second line of one booking whose date is wrong", () => {
    beforeEach(() => {
      database.push(aTrip("t1", "ANRDUB2813025", "EUCU4590355", TUESDAY));
      database.push(aTrip("t2", "ANRDUB2813025", "EUCU4590366", WEDNESDAY));
    });

    it("finds each line its own Trip and corrects the second line's date", async () => {
      const { rows, result } = await check([
        line(TUESDAY, "ANRDUB2813025", "EUCU4590355"),
        line(TUESDAY, "ANRDUB2813025", "EUCU4590366"),
      ]);

      expect(rows.map((row) => [row.status, row.trip?.id])).toEqual([
        ["MATCHED", "t1"],
        ["MATCHED", "t2"],
      ]);
      expect(rows[1].dateCorrection).toEqual({ invoicePlanningDate: TUESDAY, tripPlanningDate: WEDNESDAY });
      expect(result.missingTrips).toEqual([]);
      expect(result.blockedMissingTrips).toEqual([]);
      expect(result.payments.filter((payment) => payment.payable).map((payment) => payment.tripId).sort()).toEqual([
        "t1",
        "t2",
      ]);
    });

    it("comes to the same answer whichever line comes first", async () => {
      const { rows } = await check([
        line(TUESDAY, "ANRDUB2813025", "EUCU4590366"),
        line(TUESDAY, "ANRDUB2813025", "EUCU4590355"),
      ]);

      expect(rows.map((row) => [row.status, row.trip?.id])).toEqual([
        ["MATCHED", "t2"],
        ["MATCHED", "t1"],
      ]);
    });
  });

  describe("never a guess", () => {
    it("several Trips of one booking on other days and containers: AMBIGUOUS, all of them named, nothing chosen", async () => {
      database.push(aTrip("t1", "ANRDUB2813025", "EUCU4590355", TUESDAY));
      database.push(aTrip("t2", "ANRDUB2813025", "EUCU4590366", TUESDAY));

      const { rows, cell, result } = await check([line(TUESDAY, "ANRDUB2813025", "EUCU9999999")]);

      expect(rows[0].status).toBe("AMBIGUOUS");
      expect(rows[0].candidates.map((trip) => trip.id).sort()).toEqual(["t1", "t2"]);
      expect(cell(2, COLUMN.container).value).toBe("EUCU 9999999");
      expect(result.markedRowNumbers).toEqual([2]);
      expect(result.missingTrips).toEqual([]);
      expect(rows[0].matchProblem).toMatch(/^2 ritten passen bij deze regel en er is niet gekozen: .*EUCU4590355.*EUCU4590366/);
    });

    it("the same booking and container on two other days: AMBIGUOUS, the date left alone", async () => {
      database.push(aTrip("t1", "ANRDUB2811064", "EUCU4590355", MONDAY));
      database.push(aTrip("t2", "ANRDUB2811064", "EUCU4590355", WEDNESDAY));

      const { rows, cell } = await check([line(TUESDAY, "ANRDUB2811064", "EUCU4590355")]);

      expect(rows[0].status).toBe("AMBIGUOUS");
      expect(toIsoDate(cell(2, COLUMN.date).value as Date)).toBe(TUESDAY);
    });

    it("pairs of values pointing at different Trips: AMBIGUOUS", async () => {
      // Date + booking say t1; booking + container say t2.
      database.push(aTrip("t1", "ANRDUB2813025", "EUCU4590355", TUESDAY));
      database.push(aTrip("t2", "ANRDUB2813025", "EUCU4590366", WEDNESDAY));

      const { rows } = await check([line(TUESDAY, "ANRDUB2813025", "EUCU4590366"), line(MONDAY, "OTHER", "EUCU1111111")]);

      expect(rows[0].status).toBe("AMBIGUOUS");
    });

    it("two lines correcting to one Trip: both CONFLICT, each naming the other row", async () => {
      database.push(aTrip("t1", "ANRDUB2813025", "EUCU4590355", WEDNESDAY));

      const { rows, result } = await check([
        line(TUESDAY, "ANRDUB2813025", "EUCU4590355"),
        line(WEDNESDAY, "ANRDUB2899999", "EUCU4590355"),
      ]);

      expect(rows.map((row) => row.status)).toEqual(["CONFLICT", "CONFLICT"]);
      expect(rows.map((row) => row.dateCorrection ?? row.bookingCorrection)).toEqual([null, null]);
      expect(rows[0].matchProblem).toContain("rij 3");
      expect(rows[1].matchProblem).toContain("rij 2");
      expect(result.payments.filter((payment) => payment.payable)).toEqual([]);
    });

    it("a line whose only candidate another line already IS: a CONFLICT naming that row, never a second match", async () => {
      database.push(aTrip("t1", "ANRDUB2813025", "EUCU4590355", TUESDAY));

      const { rows } = await check([
        line(TUESDAY, "ANRDUB2813025", "EUCU4590355"),
        line(TUESDAY, "ANRDUB2813025", "EUCU9999999"),
      ]);

      expect(rows[0]).toMatchObject({ status: "MATCHED", trip: { id: "t1" } });
      expect(rows[1]).toMatchObject({ status: "CONFLICT", trip: null, containerCorrection: null });
      expect(rows[1].matchProblem).toContain("rij 2 al exact vermeldt");
    });

    it("one shared value is not enough: NOT_FOUND, with what to check", async () => {
      database.push(aTrip("t1", "ANRDUB2813025", "EUCU4590355", WEDNESDAY));

      const { rows } = await check([line(TUESDAY, "ANRDUB2813025", "EUCU9999999")]);

      expect(rows[0].status).toBe("NOT_FOUND");
      // All three pairs were tried before calling it not found.
      expect(rows[0].matchProblem).toBe(
        "Gecontroleerd: boekingsnummer + datum, containernummer + datum en boekingsnummer + containernummer. Geen enkele rit in Trano deelt minstens twee van deze drie waarden met de regel.",
      );
    });
  });

  describe("missing transports are decided after the whole matching", () => {
    it("a line with a wrong date is its Trip, so that Trip is neither added nor blocked", async () => {
      database.push(aTrip("t1", "ANRDUB2811064", "EUCU4590355", WEDNESDAY));

      const { result } = await check([line(TUESDAY, "ANRDUB2811064", "EUCU4590355")]);

      expect(result.missingTrips).toEqual([]);
      expect(result.blockedMissingTrips).toEqual([]);
    });

    it("a Trip no line is about is still added as missing", async () => {
      database.push(aTrip("t1", "ANRDUB2811064", "EUCU4590355", WEDNESDAY));
      database.push(aTrip("t9", "ANRDUB2819999", "EUCU4599999", WEDNESDAY));

      const { result } = await check([line(TUESDAY, "ANRDUB2811064", "EUCU4590355")]);

      expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["t9"]);
    });
  });

  /**
   * Example C: the transport is matched; only its `EC 4214683` line names a
   * confirmation this system does not hold. The transport is still checked and
   * payable — the EC line alone stays open.
   */
  it("an EC line without its confirmation leaves its matched transport checked and payable", async () => {
    database.push(aTrip("t1", "ANRDUB2812203", "EUCU4590355", TUESDAY));

    const { rows, result } = await check([
      line(TUESDAY, "ANRDUB2812203", "EUCU4590355"),
      {
        planningDate: day(TUESDAY),
        bookingNumber: "ANRDUB2812203",
        containerNumber: "",
        tarief: null,
        ek: 25,
        remarks: "EC 4214683",
        containerType: null,
        startPoint: null,
        endPoint: null,
      },
    ]);

    expect(rows.map((row) => row.status)).toEqual(["MATCHED", "COST_LINE_UNRESOLVED"]);
    expect(rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
    expect(result.payments).toEqual([expect.objectContaining({ tripId: "t1", payable: true })]);
    expect(rows[1].matchProblem).toBe(
      "Geen kostenbevestiging gevonden voor EC 4214683. De rit zelf is wel gematcht (Excel-rij 2); alleen het EK-bedrag van deze regel is niet gecontroleerd.",
    );
  });

  /** An EC line as the customer writes one, stating the container this time. */
  function ecLine(booking: string, container: string, ccNumber: string): InvoiceFixtureLine {
    return {
      planningDate: day(TUESDAY),
      bookingNumber: booking,
      containerNumber: `${container.slice(0, 4)} ${container.slice(4)}`,
      tarief: null,
      ek: 25,
      remarks: `EC ${ccNumber}`,
      containerType: null,
      startPoint: null,
      endPoint: null,
    };
  }

  describe("an EC line whose booking is misprinted, its container and date right", () => {
    beforeEach(() => {
      database.push(aTrip("t1", "ANRDUB2812203", "EUCU4590355", TUESDAY));
    });

    it("is linked to its confirmation, the booking corrected in red", async () => {
      confirmations.push({ tripId: "t1", ccNumber: "4214683", amount: new Prisma.Decimal(25) });

      const { rows, cell } = await check([
        line(TUESDAY, "ANRDUB2812203", "EUCU4590355"),
        ecLine("AMRDIB2812203", "EUCU4590355", "4214683"),
      ]);

      expect(rows[1]).toMatchObject({
        status: "COST_LINE",
        trip: { id: "t1" },
        costConfirmation: { ccNumber: "4214683" },
        bookingCorrection: { invoiceBookingNumber: "AMRDIB2812203", tripBookingNumber: "ANRDUB2812203" },
      });
      expect(cell(3, COLUMN.booking).value).toBe("ANRDUB2812203");
      expect(isRed(cell(3, COLUMN.booking))).toBe(true);
    });

    /**
     * Example C: the confirmation is unknown. The transport is found apart — its
     * container and date — and its booking corrected; the EC line stays
     * unresolved, and says that it is the confirmation, not the transport, that
     * is missing.
     */
    it("without its confirmation: the transport found and the booking corrected, the EC line still unresolved", async () => {
      const { rows, cell, result } = await check([
        line(TUESDAY, "ANRDUB2812203", "EUCU4590355"),
        ecLine("AMRDIB2812203", "EUCU4590355", "4214683"),
      ]);

      expect(rows[1]).toMatchObject({
        status: "COST_LINE_UNRESOLVED",
        trip: null,
        bookingCorrection: { tripBookingNumber: "ANRDUB2812203" },
        matchProblem:
          "Geen kostenbevestiging gevonden voor EC 4214683. De rit zelf is wel gematcht (Excel-rij 2); alleen het EK-bedrag van deze regel is niet gecontroleerd.",
      });
      expect(cell(3, COLUMN.booking).value).toBe("ANRDUB2812203");
      expect(isRed(cell(3, COLUMN.booking))).toBe(true);
      expect(result.payments).toEqual([expect.objectContaining({ tripId: "t1", payable: true })]);
    });

    it("says the transport was found but is not on the invoice when no line of its own charges it", async () => {
      const { rows } = await check([line(TUESDAY, "ANRDUB2819999", "EUCU9999999"), ecLine("AMRDIB2812203", "EUCU4590355", "4214683")]);

      expect(rows[1].matchProblem).toBe(
        "Geen kostenbevestiging gevonden voor EC 4214683. De rit zelf is wel gevonden (ANRDUB2812203 · EUCU4590355 · 06/10/2026 · afgewerkt), maar staat niet als transportregel op deze factuur; hij wordt beoordeeld als ontbrekende rit.",
      );
    });
  });

  it("matches the whole document the same way in any order", async () => {
    database.push(
      aTrip("exact", "ANRDUB2810001", "EUCU1000001", TUESDAY),
      aTrip("booking", "ANRDUB2810002", "EUCU1000002", TUESDAY),
      aTrip("date", "ANRDUB2810003", "EUCU1000003", WEDNESDAY),
      aTrip("container", "ANRDUB2810004", "EUCU1000004", TUESDAY),
      aTrip("first", "ANRDUB2810005", "EUCU1000051", TUESDAY),
      aTrip("second", "ANRDUB2810005", "EUCU1000052", WEDNESDAY),
    );
    const lines = [
      line(TUESDAY, "ANRDUB2810001", "EUCU1000001"),
      line(TUESDAY, "ANRDUB2819992", "EUCU1000002"),
      line(TUESDAY, "ANRDUB2810003", "EUCU1000003"),
      line(TUESDAY, "ANRDUB2810004", "EUCU9000004"),
      line(TUESDAY, "ANRDUB2810005", "EUCU1000052"),
      line(TUESDAY, "ANRDUB2810005", "EUCU1000051"),
    ];
    const byLine = async (ordered: readonly InvoiceFixtureLine[]) =>
      new Map((await check(ordered)).rows.map((row) => [`${row.bookingNumber}|${row.containerNumber}`, row.trip?.id]));

    const forwards = await byLine(lines);
    const backwards = await byLine([...lines].reverse());

    expect(backwards).toEqual(forwards);
    expect([...forwards.values()].sort()).toEqual(["booking", "container", "date", "exact", "first", "second"]);
  });

  /**
   * Week 41, R46: `2026-10-06 · ANRDUB2814165 · PVDU 1111246`, reported as "no
   * Trip found" while Trano holds a Trip with that booking on that day.
   *
   * The Trip WAS a candidate — fetched with the line's booking and day — but it
   * holds no container, so there was nothing to correct the line's container to,
   * and that one case answered NOT_FOUND. Two values naming one Trip is a match.
   */
  describe("example D: ANRDUB2814165 on 6 October, its container not Trano's", () => {
    const R46 = () => line(TUESDAY, "ANRDUB2814165", "PVDU1111246");

    it("matches the Trip holding no container, writes nothing over the line's container, and does not add it again", async () => {
      database.push(aTrip("t1", "ANRDUB2814165", null as unknown as string, TUESDAY));

      const { rows, cell, result } = await check([R46()]);

      expect(rows[0]).toMatchObject({ status: "MATCHED", trip: { id: "t1" }, containerCorrection: null, matchProblem: null });
      expect(cell(2, COLUMN.container).value).toBe("PVDU 1111246");
      expect(isRed(cell(2, COLUMN.container))).toBe(false);
      expect(result.missingTrips).toEqual([]);
      expect(result.blockedMissingTrips).toEqual([]);
      expect(result.payments).toEqual([expect.objectContaining({ tripId: "t1", payable: true })]);
    });

    it("matches a Trip holding another container, and corrects the container in red in the written file", async () => {
      database.push(aTrip("t1", "ANRDUB2814165", "PVDU1111999", TUESDAY));

      const { rows, cell, result } = await check([R46()]);

      expect(rows[0]).toMatchObject({
        status: "MATCHED",
        trip: { id: "t1" },
        containerCorrection: { invoiceContainerNumber: "PVDU 1111246", tripContainerNumber: "PVDU1111999" },
      });
      expect(cell(2, COLUMN.container).value).toBe("PVDU1111999");
      expect(isRed(cell(2, COLUMN.container))).toBe(true);
      // Only that cell changed colour on the row's identity.
      expect([isRed(cell(2, COLUMN.booking)), isRed(cell(2, COLUMN.date))]).toEqual([false, false]);
      expect(result.missingTrips).toEqual([]);
    });

    it("reads the same day from a date cell, an Excel serial or ISO text", async () => {
      database.push(aTrip("t1", "ANRDUB2814165", null as unknown as string, TUESDAY));

      for (const planningDate of [day(TUESDAY), 46301, TUESDAY]) {
        const { rows } = await check([{ ...R46(), planningDate }]);

        expect(rows[0]).toMatchObject({ status: "MATCHED", trip: { id: "t1" } });
      }
    });

    it("does not match on the booking alone, on another day", async () => {
      database.push(aTrip("t1", "ANRDUB2814165", null as unknown as string, WEDNESDAY));

      const { rows } = await check([R46()]);

      expect(rows[0].status).toBe("NOT_FOUND");
    });

    it("keeps two Trips of that booking on that day ambiguous", async () => {
      database.push(aTrip("t1", "ANRDUB2814165", null as unknown as string, TUESDAY));
      database.push(aTrip("t2", "ANRDUB2814165", "PVDU1111999", TUESDAY));

      const { rows } = await check([R46()]);

      expect(rows[0]).toMatchObject({ status: "AMBIGUOUS", trip: null });
      expect(rows[0].candidates.map((trip) => trip.id).sort()).toEqual(["t1", "t2"]);
    });

    it("is a conflict naming the row when another line already IS that Trip exactly", async () => {
      database.push(aTrip("t1", "ANRDUB2814165", "PVDU1111999", TUESDAY));

      const { rows } = await check([line(TUESDAY, "ANRDUB2814165", "PVDU1111999"), R46()]);

      expect(rows[0]).toMatchObject({ status: "MATCHED", trip: { id: "t1" } });
      expect(rows[1]).toMatchObject({ status: "CONFLICT", trip: null, containerCorrection: null });
      expect(rows[1].matchProblem).toContain("rij 2");
    });

    it("is a conflict for both when two lines reach the container-less Trip on two values", async () => {
      database.push(aTrip("t1", "ANRDUB2814165", null as unknown as string, TUESDAY));

      const { rows } = await check([R46(), line(TUESDAY, "ANRDUB2814165", "PVDU1111777")]);

      expect(rows.map((row) => row.status)).toEqual(["CONFLICT", "CONFLICT"]);
      expect(rows[0].matchProblem).toContain("rij 3");
    });
  });

  /**
   * Example E — week 41 R107: `2026-10-08 · DUBANR2810438 · EUCU 4580552 · EK
   * 386,16 · EC 4224479`, an EC line with no transport line of its own. The EC
   * line charges a cost beside the transport; it is never the transport's line.
   */
  describe("example E: an EC line whose transport has no line of its own", () => {
    const THURSDAY = "2026-10-08";
    const EK = 20;
    const R107 = () => ({ ...ecLine("DUBANR2810438", "EUCU4580552", "4224479"), planningDate: day(THURSDAY), ek: 386.16 });
    const anotherTransport = () => line(TUESDAY, "ANRDUB2810001", "EUCU1000001");

    beforeEach(() => {
      database.push(aTrip("other", "ANRDUB2810001", "EUCU1000001", TUESDAY));
      database.push(aTrip("gent", "DUBANR2810438", "EUCU4580552", THURSDAY));
    });

    it("B, confirmation unknown: the transport is added as missing, the EC line stays apart", async () => {
      const { rows, result, cell } = await check([anotherTransport(), R107()]);

      expect(rows[1]).toMatchObject({ status: "COST_LINE_UNRESOLVED", trip: null });
      expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["gent"]);
      expect(result.payments.filter((payment) => payment.tripId === "gent")).toEqual([
        expect.objectContaining({ payable: true, category: "ADDED", rowNumbers: [4] }),
      ]);
      // The EC line is untouched; the added line charges the transport.
      expect(cell(3, EK).value).toBe(386.16);
      expect(cell(4, COLUMN.booking).value).toBe("DUBANR2810438");
      expect(cell(4, COLUMN.tarief).value).toBe(200);
    });

    it("B, confirmation known: the transport is added once, its EK not charged a second time", async () => {
      confirmations.push({ tripId: "gent", ccNumber: "4224479", amount: new Prisma.Decimal("386.16") });
      ekOf.set("gent", "386.16");

      const { rows, result, cell } = await check([anotherTransport(), R107()]);

      expect(rows[1]).toMatchObject({ status: "COST_LINE", trip: { id: "gent" }, pricingStatus: "MATCHED_NO_CHANGES" });
      expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["gent"]);
      // The EK is on the EC line already: the added line carries none.
      expect(cell(4, EK).value).toBeNull();
      expect(cell(4, COLUMN.tarief).value).toBe(200);
      expect(result.payments.filter((payment) => payment.tripId === "gent")).toEqual([
        expect.objectContaining({ payable: true, category: "ADDED", rowNumbers: [3, 4] }),
      ]);
    });

    /*
     * Beside a transport line with the same date, booking and container, an EK
     * line is that transport's split EK (`supplementary-cost-line.ts`): the two
     * rows are one transport, compared once, the EK counted once.
     */
    it("A, the transport line is there with the same three values: one transport over two rows, the EK once", async () => {
      confirmations.push({ tripId: "gent", ccNumber: "4224479", amount: new Prisma.Decimal("386.16") });
      ekOf.set("gent", "386.16");

      const { rows, result, cell } = await check([
        anotherTransport(),
        { ...line(THURSDAY, "DUBANR2810438", "EUCU4580552"), ek: null },
        R107(),
      ]);

      expect(rows.slice(1).map((row) => [row.status, row.trip?.id, row.pricingStatus, row.sharedKeyRowNumbers])).toEqual([
        ["MATCHED", "gent", "MATCHED_NO_CHANGES", [4]],
        ["MATCHED", "gent", "MATCHED_NO_CHANGES", [3]],
      ]);
      // No transport price lands on the EK row, and nothing is added.
      expect(cell(4, COLUMN.tarief).value).toBeNull();
      expect(result.missingTrips).toEqual([]);
      expect(result.payments.filter((payment) => payment.tripId === "gent")).toEqual([
        expect.objectContaining({ payable: true, rowNumbers: [3, 4] }),
      ]);
    });

    const ecWithoutContainer = () => ({ ...R107(), containerNumber: "" });

    it("A, the transport line is there and a separate EC line: each checked on its own, the EK once", async () => {
      confirmations.push({ tripId: "gent", ccNumber: "4224479", amount: new Prisma.Decimal("386.16") });
      ekOf.set("gent", "386.16");

      const { rows, result, cell } = await check([
        anotherTransport(),
        { ...line(THURSDAY, "DUBANR2810438", "EUCU4580552"), ek: null },
        ecWithoutContainer(),
      ]);

      expect(rows.slice(1).map((row) => [row.status, row.trip?.id, row.pricingStatus])).toEqual([
        ["MATCHED", "gent", "MATCHED_NO_CHANGES"],
        ["COST_LINE", "gent", "MATCHED_NO_CHANGES"],
      ]);
      // The EC line carries the EK: the transport line is not raised to it as well.
      expect(cell(3, EK).value).toBeNull();
      expect(result.missingTrips).toEqual([]);
      expect(result.payments.filter((payment) => payment.tripId === "gent")).toEqual([
        expect.objectContaining({ payable: true, rowNumbers: [3, 4] }),
      ]);
    });

    it("A, an empty transport line beside its EC line: the prices filled from Trano, the EK not a second time", async () => {
      confirmations.push({ tripId: "gent", ccNumber: "4224479", amount: new Prisma.Decimal("386.16") });
      ekOf.set("gent", "386.16");

      const { rows, result, cell } = await check([
        anotherTransport(),
        { ...line(THURSDAY, "DUBANR2810438", "EUCU4580552"), tarief: null, fuel: null },
        ecWithoutContainer(),
      ]);

      expect(rows[1]).toMatchObject({ status: "MATCHED", trip: { id: "gent" }, transportPricesFilled: true });
      expect(rows[1].comparisons.map((comparison) => [comparison.component, comparison.outcome])).toEqual([
        ["Tarief", "FILLED"],
        ["Fuel", "FILLED"],
      ]);
      expect([cell(3, COLUMN.tarief).value, cell(3, COLUMN.fuel).value, cell(3, EK).value]).toEqual([200, 30, null]);
      // The EC line keeps its own figure, and is not given a transport price.
      expect([cell(4, EK).value, cell(4, COLUMN.tarief).value]).toEqual([386.16, null]);
      expect(result.missingTrips).toEqual([]);
      expect(result.payments.filter((payment) => payment.tripId === "gent")).toEqual([
        expect.objectContaining({ payable: true, rowNumbers: [3, 4] }),
      ]);
    });

    it("A, the transport line is there and the confirmation unknown: the transport checked and payable, nothing added", async () => {
      const { rows, result } = await check([
        anotherTransport(),
        line(THURSDAY, "DUBANR2810438", "EUCU4580552"),
        ecWithoutContainer(),
      ]);

      expect(rows[1]).toMatchObject({ status: "MATCHED", trip: { id: "gent" } });
      expect(rows[2]).toMatchObject({ status: "COST_LINE_UNRESOLVED" });
      expect(rows[2].matchProblem).toContain("De rit zelf is wel gematcht (Excel-rij 3)");
      expect(result.missingTrips).toEqual([]);
      expect(result.payments.filter((payment) => payment.tripId === "gent")).toEqual([
        expect.objectContaining({ payable: true, rowNumbers: [3] }),
      ]);
    });
  });

  it("leaves the received file byte for byte as it was", async () => {
    database.push(aTrip("t1", "ANRDUB2811064", "EUCU4590355", WEDNESDAY));

    const { receivedUnchanged } = await check([line(TUESDAY, "ANRDUB2811064", "EUCU4590355")]);

    expect(receivedUnchanged).toBe(true);
  });
});

function priced(tarief: string, brandstof: string, ek = "0"): CurrentTripPricing {
  const zero = new Prisma.Decimal(0);

  return reliablyPriced({
    components: [],
    tarief: new Prisma.Decimal(tarief),
    brandstof: new Prisma.Decimal(brandstof),
    backload: zero,
    tol: zero,
    tunnel: zero,
    others: zero,
    ek: new Prisma.Decimal(ek),
    totaal: new Prisma.Decimal(tarief).add(brandstof).add(ek),
  });
}
