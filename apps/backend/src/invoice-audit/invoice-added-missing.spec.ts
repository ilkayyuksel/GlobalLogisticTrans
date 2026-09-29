import ExcelJS from "exceljs";
import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import type { EffectivePricing } from "../trip-pricing/effective-pricing";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { TripRepository } from "../trips/trip.repository";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import { InvoiceAuditService } from "./invoice-audit.service";
import { InvoiceRowMatchingService } from "./matching/invoice-row-matching.service";
import { MissingTripsService } from "./missing/missing-trips.service";
import { InvoicePricingService } from "./pricing/invoice-pricing.service";
import { AUDIT_MARKER_SHEET } from "./workbook/invoice-audit-marker";
import { InvoiceSheetReader } from "./workbook/invoice-sheet.reader";
import { InvoiceSheetWriter } from "./workbook/invoice-sheet.writer";

/**
 * A line this system added, on the next upload of the same document.
 *
 * ── THE PROBLEM THIS FILE EXISTS FOR ────────────────────────────────────────
 * A transport the invoice forgot is written in below it and left unpaid: nobody
 * has paid for a line the customer never sent. But the corrected document now
 * STATES that transport, so the next upload would read it as an ordinary
 * invoice line and settle it — money marked received because we wrote the line
 * ourselves.
 *
 * So the document remembers which rows it got from us. Those lines are priced
 * and corrected exactly like any other, and they are never settled — while the
 * SAME transport, invoiced for real by the customer next week, is settled like
 * anything else. The protection belongs to the document, not to the transport.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));

const COLUMN = { bookingNumber: 5, tarief: 12, fuel: 13, backload: 14 } as const;

function pricing(overrides: Record<string, string> = {}): EffectivePricing {
  const amount = (key: string) => new Prisma.Decimal(overrides[key] ?? "0");

  return {
    components: [],
    tarief: amount("tarief"),
    brandstof: amount("brandstof"),
    backload: amount("backload"),
    tol: amount("tol"),
    tunnel: amount("tunnel"),
    others: amount("others"),
    ek: amount("ek"),
    totaal: amount("totaal"),
  };
}

function trip(
  id: string,
  bookingNumber: string,
  containerNumber: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: MONDAY,
    startTime: new Date("1970-01-01T08:30:00.000Z"),
    bookingNumber,
    containerNumber,
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "MELSELE",
    direction: "DELIVERY",
    tripGroupId: null,
    distanceKm: new Prisma.Decimal("31.00"),
    ...overrides,
  };
}

describe("a line this system added to the invoice", () => {
  let trips: {
    findManyForInvoice: jest.Mock;
    findClosedUnpaidBetween: jest.Mock;
    setPaidMany: jest.Mock;
  };
  let effectivePricing: { findForTrips: jest.Mock };
  let service: InvoiceAuditService;

  beforeEach(() => {
    trips = {
      findManyForInvoice: jest.fn().mockResolvedValue([]),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      setPaidMany: jest.fn(async (ids: readonly string[]) => ids.length),
    };
    effectivePricing = { findForTrips: jest.fn().mockResolvedValue(new Map()) };

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    service = new InvoiceAuditService(
      new InvoiceSheetReader(logger),
      new InvoiceRowMatchingService(trips as unknown as TripRepository, logger),
      new InvoicePricingService(
        effectivePricing as unknown as EffectivePricingService,
        logger,
      ),
      new MissingTripsService(
        trips as unknown as TripRepository,
        effectivePricing as unknown as EffectivePricingService,
        logger,
      ),
      new InvoiceSheetWriter(logger),
      trips as unknown as TripRepository,
      logger,
    );
  });

  const upload = (workbook: Buffer, name = "week 13 - 2026 GLT.xlsx") => ({
    buffer: workbook,
    originalname: name,
    size: workbook.length,
  });

  async function readBack(workbook: Buffer) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(workbook as unknown as ArrayBuffer);

    return book;
  }

  /** The ids the last run marked paid. */
  const paidIds = () =>
    (trips.setPaidMany.mock.calls.at(-1)?.[0] ?? []) as readonly string[];

  /** The customer's own invoice: one line, and a transport it forgot. */
  async function anInvoiceMissingOneTransport(
    missing: Record<string, unknown>,
    missingPricing = pricing({ tarief: "517.20", brandstof: "51.72" }),
  ) {
    trips.findManyForInvoice.mockResolvedValue([
      trip("trip-1", "DUBANR2718284", "EUCU4581604"),
    ]);
    trips.findClosedUnpaidBetween.mockResolvedValue([missing]);
    effectivePricing.findForTrips.mockImplementation((ids: readonly string[]) =>
      Promise.resolve(
        new Map(
          ids.map((id) => [
            id,
            id === "trip-1"
              ? pricing({ tarief: "370", brandstof: "37" })
              : missingPricing,
          ]),
        ),
      ),
    );

    return buildInvoiceWorkbook({
      lines: [
        {
          planningDate: MONDAY,
          bookingNumber: "DUBANR2718284",
          containerNumber: "EUCU 4581604",
          tarief: 370,
          fuel: 37,
        },
      ],
    });
  }

  describe("the first processing", () => {
    it("adds the transport, leaves it unpaid, and records the row", async () => {
      const first = await service.apply(
        upload(await anInvoiceMissingOneTransport(trip("missing-1", "BELANR2720016", "EUCU2451828"))),
      );

      expect(first.rowsAdded).toBe(1);
      expect(paidIds()).toEqual(["trip-1"]);

      const book = await readBack(first.workbook);
      const record = book.getWorksheet(AUDIT_MARKER_SHEET);

      expect(record).toBeDefined();
      // Invisible in Excel's own interface: it cannot even be unhidden there.
      expect(record?.state).toBe("veryHidden");
      expect(record?.getRow(2).getCell(2).value).toBe("missing-1");
    });
  });

  describe("uploading the corrected document again", () => {
    async function processTwice(
      missing = trip("missing-1", "BELANR2720016", "EUCU2451828"),
      secondPricing = pricing({ tarief: "517.20", brandstof: "51.72" }),
    ) {
      const first = await service.apply(
        upload(await anInvoiceMissingOneTransport(missing)),
      );

      /*
       * The database as the first run left it: the customer's own transport is
       * settled, the added one is not, and the document now states both — so
       * nothing is missing from it any more.
       */
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604", { isPaid: true }),
        missing,
      ]);
      trips.findClosedUnpaidBetween.mockResolvedValue([]);
      effectivePricing.findForTrips.mockImplementation((ids: readonly string[]) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              id === "trip-1"
                ? pricing({ tarief: "370", brandstof: "37" })
                : secondPricing,
            ]),
          ),
        ),
      );

      const second = await service.apply(
        upload(first.workbook, "week 13 - 2026 GLT - gecorrigeerd.xlsx"),
      );

      return { first, second };
    }

    it("recognises the line as one this system added", async () => {
      const { second } = await processTwice();

      const added = second.result.rows.find(
        (row) => row.bookingNumber === "BELANR2720016",
      );

      expect(added?.status).toBe("ADDED_MISSING");
      expect(second.result.summary.addedMissing).toBe(1);
    });

    it("does not settle it", async () => {
      const { second } = await processTwice();

      expect(paidIds()).not.toContain("missing-1");
      expect(second.paidTrips).toBe(0);
      expect(second.alreadyPaid).toBe(1);
    });

    it("still settles the customer's own line", async () => {
      const { second } = await processTwice();

      const own = second.result.rows.find(
        (row) => row.bookingNumber === "DUBANR2718284",
      );

      expect(own?.status).toBe("MATCHED");
      // Already paid by the first run, and counted as such rather than paid twice.
      expect(second.alreadyPaid).toBe(1);
    });

    /** §7: the prices of an added line are checked and corrected as any other. */
    it("checks its prices, and corrects them when they have moved", async () => {
      const { second } = await processTwice(
        trip("missing-1", "BELANR2720016", "EUCU2451828"),
        // What this system holds NOW, after a rate change.
        pricing({ tarief: "600", brandstof: "60" }),
      );

      const added = second.result.rows.find(
        (row) => row.bookingNumber === "BELANR2720016",
      );

      expect(added?.pricingStatus).toBe("PRICING_CORRECTED");
      expect(
        added?.differences.map((difference) => [
          difference.component,
          difference.correctedValue,
        ]),
      ).toEqual([
        ["Tarief", "600.00"],
        ["Fuel", "60.00"],
      ]);

      const sheet = (await readBack(second.workbook)).worksheets[0];
      const row = added!.rowNumber;

      expect(sheet.getRow(row).getCell(COLUMN.tarief).value).toBe(600);
      // And still not settled, however much its price moved.
      expect(paidIds()).not.toContain("missing-1");
    });

    it("adds no second copy of it", async () => {
      const { second } = await processTwice();

      expect(second.rowsAdded).toBe(0);

      const sheet = (await readBack(second.workbook)).worksheets[0];
      const bookings: string[] = [];

      sheet.eachRow({ includeEmpty: false }, (row) => {
        const booking = row.getCell(COLUMN.bookingNumber).value;

        if (typeof booking === "string" && booking !== "Bookingnr") {
          bookings.push(booking);
        }
      });

      expect(bookings.filter((booking) => booking === "BELANR2720016")).toHaveLength(1);
    });

    it("does not mark it as a problem", async () => {
      const { second } = await processTwice();

      const added = second.result.rows.find(
        (row) => row.bookingNumber === "BELANR2720016",
      );
      const sheet = (await readBack(second.workbook)).worksheets[0];

      expect(
        sheet.getRow(added!.rowNumber).getCell(COLUMN.bookingNumber).fill,
      ).toBeUndefined();
    });

    it("keeps the record for a third run", async () => {
      const { second } = await processTwice();

      trips.findClosedUnpaidBetween.mockResolvedValue([]);

      const third = await service.apply(
        upload(second.workbook, "week 13 - 2026 GLT - gecorrigeerd.xlsx"),
      );

      expect(third.result.summary.addedMissing).toBe(1);
      expect(third.rowsAdded).toBe(0);
      expect(paidIds()).not.toContain("missing-1");
    });

    /** A Combination leg keeps its own surcharge through all of it. */
    it("keeps a Combination's Backload, and still does not settle it", async () => {
      const { second } = await processTwice(
        trip("missing-1", "BELANR2720016", "EUCU2451828", { tripGroupId: "group-1" }),
        pricing({ tarief: "210", brandstof: "21", backload: "50" }),
      );

      const added = second.result.rows.find(
        (row) => row.bookingNumber === "BELANR2720016",
      );
      const sheet = (await readBack(second.workbook)).worksheets[0];

      expect(added?.status).toBe("ADDED_MISSING");
      expect(sheet.getRow(added!.rowNumber).getCell(COLUMN.backload).value).toBe(50);
      expect(paidIds()).not.toContain("missing-1");
    });
  });

  describe("the protection belongs to the document", () => {
    /**
     * ── NEXT WEEK'S INVOICE IS A DIFFERENT DOCUMENT ─────────────────────────
     * The same transport, stated by the customer on an invoice of their own, is
     * an ordinary line: matched, priced and settled. Nothing about "we once
     * added it" travels with the Trip.
     */
    it("settles the same transport when the customer invoices it", async () => {
      const missing = trip("missing-1", "BELANR2720016", "EUCU2451828");

      await service.apply(upload(await anInvoiceMissingOneTransport(missing)));

      trips.findManyForInvoice.mockResolvedValue([missing]);
      trips.findClosedUnpaidBetween.mockResolvedValue([]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["missing-1", pricing({ tarief: "517.20", brandstof: "51.72" })]]),
      );

      // The customer's OWN next invoice: a plain document, no record in it.
      const theirInvoice = await buildInvoiceWorkbook({
        lines: [
          {
            planningDate: MONDAY,
            bookingNumber: "BELANR2720016",
            containerNumber: "EUCU 2451828",
            tarief: 517.2,
            fuel: 51.72,
          },
        ],
      });

      const applied = await service.apply(upload(theirInvoice, "week 14 - 2026 GLT.xlsx"));

      expect(applied.result.rows[0].status).toBe("MATCHED");
      expect(paidIds()).toEqual(["missing-1"]);
    });

    /** Being unpaid is not what stops it — the record is. */
    it("settles an ordinary unpaid line like any other", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604", { isPaid: false }),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37" })]]),
      );

      const applied = await service.apply(
        upload(
          await buildInvoiceWorkbook({
            lines: [
              {
                planningDate: MONDAY,
                bookingNumber: "DUBANR2718284",
                containerNumber: "EUCU 4581604",
                tarief: 370,
                fuel: 37,
              },
            ],
          }),
        ),
      );

      expect(applied.paidTrips).toBe(1);
      expect(paidIds()).toEqual(["trip-1"]);
    });

    /**
     * The record names the row AND the transport written on it. A customer who
     * types another transport over that row has written their own line.
     */
    it("lets go when the row is rewritten into another transport", async () => {
      const first = await service.apply(
        upload(await anInvoiceMissingOneTransport(trip("missing-1", "BELANR2720016", "EUCU2451828"))),
      );

      const book = await readBack(first.workbook);
      const sheet = book.worksheets[0];
      const addedRow = first.result.missingTrips[0].rowNumber;

      sheet.getRow(addedRow).getCell(COLUMN.bookingNumber).value = "ANRDUB2725107";
      sheet.getRow(addedRow).getCell(6).value = "TLLU 1595717";
      sheet.getRow(addedRow).commit();

      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604", { isPaid: true }),
        trip("other-1", "ANRDUB2725107", "TLLU1595717"),
      ]);
      trips.findClosedUnpaidBetween.mockResolvedValue([]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([
          ["trip-1", pricing({ tarief: "370", brandstof: "37" })],
          ["other-1", pricing({ tarief: "517.20", brandstof: "51.72" })],
        ]),
      );

      const edited = Buffer.from(await book.xlsx.writeBuffer());
      const applied = await service.apply(upload(edited, "week 13 - edited.xlsx"));

      const rewritten = applied.result.rows.find(
        (row) => row.bookingNumber === "ANRDUB2725107",
      );

      expect(rewritten?.status).toBe("MATCHED");
      expect(paidIds()).toContain("other-1");
    });
  });
});
