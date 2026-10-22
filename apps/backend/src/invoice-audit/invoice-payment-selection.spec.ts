import { Prisma, RouteMatchMethod, Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import type { CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import { buildInvoiceAuditService, buildInvoicePaymentService } from "./__fixtures__/invoice-audit-service";
import { EXACT_ROUTE_MATCH, reliablyPriced } from "./__fixtures__/invoice-pricing";
import { invoiceReads } from "./__fixtures__/invoice-reads";
import { tripRecord } from "./__fixtures__/invoice-rows";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { PaymentSelectionNoLongerEligibleException } from "./exceptions/invoice-audit.exceptions";

/**
 * From the Excel lines to the payment confirmation, over ONE synthetic week:
 * which transports are offered for payment (and chosen to begin with, which is
 * every payable one not yet paid — `invoice-payment-confirm.tsx`), why each
 * other one is not, and what the confirmation changes.
 *
 * The database is a list of Trips every read filters, so a line finds only what
 * a real query would return. Booking ANRDUB2810005 holds three transports on
 * three days with three containers. Week 41: Monday 5 to Friday 9 October.
 */

const TUESDAY = "2026-10-06";
const WEDNESDAY = "2026-10-07";
const THURSDAY = "2026-10-08";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const UNRELIABLE = "unreliable";

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

function line(date: string, booking: string, container: string): InvoiceFixtureLine {
  return {
    planningDate: day(date),
    bookingNumber: booking,
    containerNumber: `${container.slice(0, 4)} ${container.slice(4)}`,
    tarief: 200,
    fuel: 30,
  };
}

/** The week's transports, and how each is priced. */
function week(): { trips: Trip[]; prices: Map<string, string> } {
  const trips = [
    aTrip("exact", "ANRDUB2810001", "EUCU1000001", TUESDAY),
    aTrip("booking-fixed", "ANRDUB2810002", "EUCU1000002", TUESDAY),
    aTrip("date-fixed", "ANRDUB2810003", "EUCU1000003", WEDNESDAY),
    aTrip("container-fixed", "ANRDUB2810004", "EUCU1000004", TUESDAY),
    aTrip("same-booking-1", "ANRDUB2810005", "EUCU1000051", TUESDAY),
    aTrip("same-booking-2", "ANRDUB2810005", "EUCU1000052", WEDNESDAY),
    aTrip("same-booking-3", "ANRDUB2810005", "EUCU1000053", THURSDAY),
    aTrip("price-problem", "ANRDUB2810006", "EUCU1000006", TUESDAY),
    aTrip("ambiguous-1", "ANRDUB2810007", "EUCU1000071", TUESDAY),
    aTrip("ambiguous-2", "ANRDUB2810007", "EUCU1000072", TUESDAY),
    aTrip("ec-missing", "ANRDUB2810008", "EUCU1000008", TUESDAY),
    aTrip("missing-unreliable", "ANRDUB2810009", "EUCU1000009", THURSDAY),
  ];

  return {
    trips,
    prices: new Map(
      trips.map((trip) => [trip.id, ["price-problem", "missing-unreliable"].includes(trip.id) ? UNRELIABLE : "200"]),
    ),
  };
}

/** The customer's lines for that week, each mistake one value at a time. */
const LINES: readonly InvoiceFixtureLine[] = [
  line(TUESDAY, "ANRDUB2810001", "EUCU1000001"), // row 2: exact
  line(TUESDAY, "ANRDUB2819992", "EUCU1000002"), // row 3: booking misprinted
  line(TUESDAY, "ANRDUB2810003", "EUCU1000003"), // row 4: date misprinted (ran Wednesday)
  line(TUESDAY, "ANRDUB2810004", "EUCU9000004"), // row 5: container misprinted
  line(TUESDAY, "ANRDUB2810005", "EUCU1000051"), // row 6: exact
  line(TUESDAY, "ANRDUB2810005", "EUCU1000052"), // row 7: the same booking, date misprinted
  // same-booking-3 is on no line: really missing, added.
  line(TUESDAY, "ANRDUB2810006", "EUCU1000006"), // row 8: exact, but its price is not reliable
  line(TUESDAY, "ANRDUB2810007", "EUCU9000079"), // row 9: two Trips could be meant
  line(TUESDAY, "ANRDUB2810008", "EUCU1000008"), // row 10: exact
  {
    // row 11: its EC line names a confirmation this system does not hold
    planningDate: day(TUESDAY),
    bookingNumber: "ANRDUB2810008",
    containerNumber: "",
    tarief: null,
    ek: 25,
    remarks: "EC 4214683",
    containerType: null,
    startPoint: null,
    endPoint: null,
  },
  // missing-unreliable is on no line: added without amounts, yellow.
];

const PAYABLE = [
  "booking-fixed",
  "container-fixed",
  "date-fixed",
  "ec-missing",
  "exact",
  "same-booking-1",
  "same-booking-2",
  "same-booking-3",
];

describe("the payment selection follows the final matching", () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;
  let database: Trip[];
  let prices: Map<string, string>;

  beforeEach(() => {
    ({ trips: database, prices } = week());
  });

  const onDay = (trip: Trip, days: readonly Date[]) =>
    days.some((each) => [trip.planningDate, trip.originalPlanningDate].some((date) => date?.getTime() === each.getTime()));

  function doubles() {
    const reads = invoiceReads();

    reads.findTripsOnDates.mockImplementation(async (days) => database.filter((trip) => onDay(trip, days)));
    reads.findTripsByBookings.mockImplementation(async (bookings) =>
      database.filter((trip) => bookings.includes(trip.bookingNumber!)),
    );

    return {
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
            (trip) => trip.status === TripStatus.CLOSED && !trip.isPaid && trip.planningDate! >= from && trip.planningDate! <= to,
          ),
        ),
      },
      effectivePricing: {
        findForTrips: jest.fn(async (ids: readonly string[]) =>
          new Map(ids.filter((id) => prices.has(id)).map((id) => [id, priced(prices.get(id)!)])),
        ),
      },
    };
  }

  /** Settles like `InvoicePaymentRepository`: only CLOSED, unpaid Trips change. */
  const repository = {
    settle: jest.fn(async (tripIds: readonly string[]) => {
      const settled = database.filter((trip) => tripIds.includes(trip.id) && trip.status === TripStatus.CLOSED && !trip.isPaid);

      database = database.map((trip) => (settled.includes(trip) ? { ...trip, isPaid: true } : trip));

      return settled.length;
    }),
  };

  async function preview() {
    const file = await buildInvoiceWorkbook({ lines: LINES, fuelPercentage: 15 });
    const checked = await buildInvoiceAuditService(doubles()).apply({ buffer: file, originalname: "week 41 - 2026 GLT.xlsx", size: file.length });

    return { file, result: checked.result };
  }

  /** What the screen chooses to begin with: every payable transport not yet paid. */
  const preselected = (payments: readonly { tripId: string; payable: boolean; alreadyPaid: boolean }[]) =>
    payments.filter((payment) => payment.payable && !payment.alreadyPaid).map((payment) => payment.tripId).sort();

  it("offers every correctly matched transport with a reliable price, however it was matched", async () => {
    const { result } = await preview();

    expect(preselected(result.payments)).toEqual(PAYABLE);
    expect(result.rows.slice(0, 6).map((row) => [row.status, row.trip?.id])).toEqual([
      ["MATCHED", "exact"],
      ["MATCHED", "booking-fixed"],
      ["MATCHED", "date-fixed"],
      ["MATCHED", "container-fixed"],
      ["MATCHED", "same-booking-1"],
      ["MATCHED", "same-booking-2"],
    ]);
  });

  it("adds the really missing transport once, and offers it when its price is relied on", async () => {
    const { result } = await preview();

    expect(result.missingTrips.map((missing) => missing.tripId).sort()).toEqual(["missing-unreliable", "same-booking-3"]);
    expect(result.blockedMissingTrips).toEqual([]);
    expect(result.payments.filter((payment) => payment.tripId === "same-booking-3")).toEqual([
      expect.objectContaining({ payable: true, category: "ADDED" }),
    ]);
  });

  it("says for every transport not offered exactly why, with the rows to fix", async () => {
    const { result } = await preview();
    const notPayable = Object.fromEntries(
      result.payments
        .filter((payment) => !payment.payable)
        .map((payment) => [payment.tripId, { reasons: payment.reasons, rows: payment.blockingRowNumbers }]),
    );

    expect(notPayable).toEqual({
      "price-problem": { reasons: ["LINE_MARKED", "PRICE_NOT_SETTLED"], rows: [] },
      "missing-unreliable": { reasons: ["PRICE_NOT_SETTLED"], rows: [] },
      "ambiguous-1": { reasons: ["AMBIGUOUS_MATCH"], rows: [9] },
      "ambiguous-2": { reasons: ["AMBIGUOUS_MATCH"], rows: [9] },
    });
    // Every transport of the week is accounted for, exactly once: 8 payable,
    // 2 with a real price problem, 2 with an open match problem.
    expect(result.payments.map((payment) => payment.tripId).sort()).toEqual(database.map((trip) => trip.id).sort());
  });

  it("keeps the EC problem on the EC line: its transport is matched and offered", async () => {
    const { result } = await preview();

    expect(result.rows.find((row) => row.rowNumber === 11)).toMatchObject({ status: "COST_LINE_UNRESOLVED" });
    expect(result.payments.find((payment) => payment.tripId === "ec-missing")).toMatchObject({ payable: true });
  });

  describe("the confirmation", () => {
    it("changes nothing before it, then pays exactly what was chosen, once", async () => {
      const { file } = await preview();

      expect(database.filter((trip) => trip.isPaid)).toEqual([]);

      const chosen = PAYABLE.filter((tripId) => tripId !== "exact");
      const service = buildInvoicePaymentService(doubles(), repository);
      const first = await service.confirm({ buffer: file, originalname: "week 41 - 2026 GLT.xlsx", size: file.length }, chosen);

      expect(first).toMatchObject({ paidTrips: 7, alreadyPaid: 0 });
      expect(database.filter((trip) => trip.isPaid).map((trip) => trip.id).sort()).toEqual([...chosen].sort());
      // Not chosen: still unpaid.
      expect(database.find((trip) => trip.id === "exact")!.isPaid).toBe(false);

      // Confirming the same choice again pays nothing a second time.
      const again = await buildInvoicePaymentService(doubles(), repository).confirm(
        { buffer: file, originalname: "week 41 - 2026 GLT.xlsx", size: file.length },
        chosen.filter((tripId) => tripId !== "same-booking-3"),
      );

      expect(again).toMatchObject({ paidTrips: 0, alreadyPaid: 6 });
    });

    it("refuses a transport with a match problem or a price problem, and pays nothing at all", async () => {
      const { file } = await preview();

      await expect(
        buildInvoicePaymentService(doubles(), repository).confirm(
          { buffer: file, originalname: "week 41 - 2026 GLT.xlsx", size: file.length },
          ["exact", "ambiguous-1", "price-problem"],
        ),
      ).rejects.toBeInstanceOf(PaymentSelectionNoLongerEligibleException);
      expect(database.filter((trip) => trip.isPaid)).toEqual([]);
    });
  });
});

function priced(tarief: string): CurrentTripPricing {
  const zero = new Prisma.Decimal(0);

  if (tarief === UNRELIABLE) {
    return {
      ...reliablyPriced({
        components: [],
        tarief: new Prisma.Decimal(200),
        brandstof: new Prisma.Decimal(30),
        backload: zero,
        tol: zero,
        tunnel: zero,
        others: zero,
        ek: zero,
        totaal: new Prisma.Decimal(230),
      }),
      routeMatch: { ...EXACT_ROUTE_MATCH, method: RouteMatchMethod.NOT_FOUND, routePricingId: null },
    };
  }

  return reliablyPriced({
    components: [],
    tarief: new Prisma.Decimal(tarief),
    brandstof: new Prisma.Decimal(30),
    backload: zero,
    tol: zero,
    tunnel: zero,
    others: zero,
    ek: zero,
    totaal: new Prisma.Decimal(tarief).add(30),
  });
}
