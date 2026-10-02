import ExcelJS from "exceljs";
import { Prisma, TripStatus } from "@prisma/client";

import { TripExportLabelsService } from "../trip-export/trip-export-labels.service";
import { AppLoggerService } from "../logger/app-logger.service";
import type { EffectivePricing } from "../trip-pricing/effective-pricing";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { TripRepository } from "../trips/trip.repository";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import { InvoiceAuditService } from "./invoice-audit.service";
import { InvoiceRowMatchingService } from "./matching/invoice-row-matching.service";
import { MissingTripsService } from "./missing/missing-trips.service";
import { InvoicePricingService } from "./pricing/invoice-pricing.service";
import { InvoiceSheetReader } from "./workbook/invoice-sheet.reader";
import { InvoiceSheetWriter } from "./workbook/invoice-sheet.writer";

/**
 * The revised match, through the whole check: the report, the corrected
 * workbook, the missing transports and the payments.
 *
 * ── WHAT IS REAL HERE ───────────────────────────────────────────────────────
 * Everything from the uploaded bytes to the corrected bytes: the reader, the
 * matcher, the pricing comparison, the missing-transport search, the writer and
 * the payment rule. Only the database is replaced, by doubles that answer the
 * three questions the check asks of it.
 */

const ORDERED = new Date(Date.UTC(2026, 8, 21));
const PLANNED = new Date(Date.UTC(2026, 8, 28));

const COLUMN = { bookingNumber: 5, containerNumber: 6, tarief: 12 } as const;
const RED = "FFFF0000";

function pricing(tarief: string): EffectivePricing {
  const zero = new Prisma.Decimal(0);

  return {
    components: [],
    tarief: new Prisma.Decimal(tarief),
    brandstof: zero,
    backload: zero,
    tol: zero,
    tunnel: zero,
    others: zero,
    ek: zero,
    totaal: new Prisma.Decimal(tarief),
  };
}

function trip(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: PLANNED,
    originalPlanningDate: PLANNED,
    startTime: new Date("1970-01-01T08:30:00.000Z"),
    bookingNumber: "ANRBEL2808541",
    containerNumber: "EUCU4591789",
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "ZEMST",
    direction: "DELIVERY",
    tripGroupId: null,
    distanceKm: new Prisma.Decimal("31.00"),
    ...overrides,
  };
}

/** One invoice line, as the customer's sheet states it. */
function line(overrides: Record<string, unknown> = {}) {
  return {
    planningDate: PLANNED,
    bookingNumber: "ANRBEL2808541",
    containerNumber: "EUCU 4591789",
    tarief: 300,
    fuel: null,
    ...overrides,
  };
}

/** The export words: none unless a test supplies them. */
const exportLabels = { findForTrips: jest.fn(async () => new Map()) };

describe("the revised match, through the whole invoice check", () => {
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
        exportLabels as unknown as TripExportLabelsService,
        logger,
      ),
      new InvoiceSheetWriter(logger),
      trips as unknown as TripRepository,
      logger,
    );
  });

  const upload = (workbook: Buffer) => ({
    buffer: workbook,
    originalname: "week 40 - 2026 GLT.xlsx",
    size: workbook.length,
  });

  /** The database holds these Trips, all priced at their own tarief. */
  function holding(stored: ReturnType<typeof trip>[], tarief = "300.00") {
    trips.findManyForInvoice.mockResolvedValue(stored);
    // Everything CLOSED and unpaid in the week is a "missing" candidate.
    trips.findClosedUnpaidBetween.mockResolvedValue(
      stored.filter((each) => each.status === TripStatus.CLOSED && !each.isPaid),
    );
    effectivePricing.findForTrips.mockResolvedValue(
      new Map(stored.map((each) => [each.id, pricing(tarief)])),
    );
  }

  async function readBack(workbook: Buffer) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(workbook as unknown as ArrayBuffer);

    return book.worksheets[0];
  }

  /**
   * The customer's sheet with formatting worth preserving: a column style the
   * container cells SHARE — the ExcelJS trap — and, on row 2, a bold font and a
   * fill of the cell's own.
   */
  async function styled(lines: ReturnType<typeof line>[]): Promise<Buffer> {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(
      (await buildInvoiceWorkbook({ lines })) as unknown as ArrayBuffer,
    );
    const sheet = book.worksheets[0];

    sheet.getColumn(COLUMN.containerNumber).font = { name: "Arial", size: 10 };

    for (let rowNumber = 2; rowNumber <= lines.length + 1; rowNumber += 1) {
      sheet.getRow(rowNumber).getCell(COLUMN.containerNumber).font = {
        name: "Arial",
        size: 10,
      };
    }

    const container = sheet.getRow(2).getCell(COLUMN.containerNumber);
    container.style = {
      ...container.style,
      font: { name: "Arial", size: 10, bold: true },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } },
    };

    return Buffer.from(await book.xlsx.writeBuffer());
  }

  const paidIds = () =>
    (trips.setPaidMany.mock.calls.at(-1)?.[0] ?? []) as readonly string[];

  describe("a re-planned transport invoiced on either of its dates", () => {
    it.each([
      ["its planning date", PLANNED],
      ["its original date", ORDERED],
    ])("matches, pays, and appends nothing when invoiced on %s", async (_label, day) => {
      holding([trip("trip-a", { planningDate: PLANNED, originalPlanningDate: ORDERED })]);

      const applied = await service.apply(
        upload(await buildInvoiceWorkbook({ lines: [line({ planningDate: day })] })),
      );

      expect(applied.result.rows[0]).toMatchObject({
        status: "MATCHED",
        containerCorrection: null,
        trip: { id: "trip-a" },
      });
      expect(paidIds()).toEqual(["trip-a"]);
      /*
       * The duplicate this guards against: invoiced on its ORIGINAL day, the
       * line's text no longer equals the Trip's planned day — and the Trip used
       * to be appended to the invoice a second time as "missing".
       */
      expect(applied.rowsAdded).toBe(0);
      expect(applied.result.missingTrips).toEqual([]);
    });
  });

  describe("a misprinted container on the one Trip of its booking and day", () => {
    async function correctedRun() {
      holding([trip("trip-a")]);

      const workbook = await styled([
        line({ containerNumber: "EUCU 9999999" }),
        line({ bookingNumber: "ANRDUB2725107", containerNumber: "TLLU 1595717" }),
      ]);

      return service.apply(upload(workbook));
    }

    it("reports the line MATCHED with its correction", async () => {
      const applied = await correctedRun();

      expect(applied.result.rows[0]).toMatchObject({
        status: "MATCHED",
        containerCorrection: {
          invoiceContainerNumber: "EUCU 9999999",
          tripContainerNumber: "EUCU4591789",
        },
      });
      expect(applied.result.summary).toMatchObject({
        matched: 1,
        containerCorrected: 1,
      });
    });

    /** J — the cell holds the Trip's container, in red, and only that cell. */
    it("writes the Trip's container into the same cell, in red", async () => {
      const sheet = await readBack((await correctedRun()).workbook);
      const container = sheet.getRow(2).getCell(COLUMN.containerNumber);

      expect(container.value).toBe("EUCU4591789");
      expect(container.font?.color?.argb).toBe(RED);
    });

    it("keeps the rest of that cell's formatting", async () => {
      const container = (await readBack((await correctedRun()).workbook))
        .getRow(2)
        .getCell(COLUMN.containerNumber);

      expect(container.font).toMatchObject({ name: "Arial", size: 10, bold: true });
      expect(container.fill).toMatchObject({
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDDEBF7" },
      });
    });

    it("colours no other cell of the row", async () => {
      const row = (await readBack((await correctedRun()).workbook)).getRow(2);

      for (const column of [COLUMN.bookingNumber, COLUMN.tarief, 1, 7, 21]) {
        expect(row.getCell(column).font?.color?.argb).not.toBe(RED);
      }
    });

    /**
     * The red stays on the corrected line. (The container column carries a
     * style of its own here; a loaded workbook was measured to give each cell
     * its own font object, so this asserts the outcome rather than proving the
     * writer's defensive copy necessary.)
     */
    it("colours no container on any other line", async () => {
      const sheet = await readBack((await correctedRun()).workbook);
      const other = sheet.getRow(3).getCell(COLUMN.containerNumber);

      expect(other.value).toBe("TLLU 1595717");
      expect(other.font?.color?.argb).not.toBe(RED);
    });

    /** It is a found transport, not a problem: no yellow. */
    it("does not mark the corrected line as a problem", async () => {
      const container = (await readBack((await correctedRun()).workbook))
        .getRow(2)
        .getCell(COLUMN.containerNumber);

      expect(container.fill).not.toMatchObject({ fgColor: { argb: "FFFFFF00" } });
    });

    /** It settles exactly like an ordinary MATCHED line. */
    it("pays the Trip like any matched line", async () => {
      await correctedRun();

      expect(paidIds()).toEqual(["trip-a"]);
    });

    /** And the Trip it resolved to is on the invoice — not appended again. */
    it("does not append the corrected Trip as missing", async () => {
      const applied = await correctedRun();

      expect(applied.rowsAdded).toBe(0);
      expect(applied.result.missingTrips).toEqual([]);
    });

    /**
     * Uploading the corrected file again: the container is right now, so it
     * is an ordinary exact match — no correction, no new colour, no payment
     * beyond the one already made.
     */
    it("is an ordinary exact match when the corrected file comes back", async () => {
      const first = await correctedRun();
      trips.findManyForInvoice.mockResolvedValue([trip("trip-a", { isPaid: true })]);
      trips.findClosedUnpaidBetween.mockResolvedValue([]);

      const again = await service.apply(upload(first.workbook));

      expect(again.result.rows[0]).toMatchObject({
        status: "MATCHED",
        containerCorrection: null,
      });
      expect(again.rowsAdded).toBe(0);
      expect(again.paidTrips).toBe(0);
      expect(again.alreadyPaid).toBe(1);
    });
  });

  describe("a misprinted container that two Trips could answer", () => {
    async function ambiguousRun() {
      holding([
        trip("trip-a", { containerNumber: "EUCU1111111", originalPlanningDate: ORDERED }),
        trip("trip-b", {
          containerNumber: "EUCU2222222",
          planningDate: new Date(Date.UTC(2026, 9, 5)),
          originalPlanningDate: PLANNED,
        }),
      ]);

      return service.apply(
        upload(await styled([line({ containerNumber: "EUCU 9999999" })])),
      );
    }

    /** G — over both dates together: AMBIGUOUS. */
    it("reports AMBIGUOUS with both candidates", async () => {
      const applied = await ambiguousRun();

      expect(applied.result.rows[0]).toMatchObject({
        status: "AMBIGUOUS",
        trip: null,
        containerCorrection: null,
      });
      expect(applied.result.rows[0].candidates).toHaveLength(2);
    });

    it("corrects nothing and colours nothing red", async () => {
      const container = (await readBack((await ambiguousRun()).workbook))
        .getRow(2)
        .getCell(COLUMN.containerNumber);

      expect(container.value).toBe("EUCU 9999999");
      expect(container.font?.color?.argb).not.toBe(RED);
    });

    it("pays neither Trip", async () => {
      await ambiguousRun();

      expect(paidIds()).toEqual([]);
    });

    /** Either candidate may be the invoiced one: neither is appended as missing. */
    it("appends neither candidate as missing", async () => {
      const applied = await ambiguousRun();

      expect(applied.rowsAdded).toBe(0);
    });
  });

  /** L — an ordinary matched line: no correction, no red. */
  describe("an ordinary matched line", () => {
    it("carries no correction and keeps its container's colour", async () => {
      holding([trip("trip-a")]);

      const applied = await service.apply(upload(await styled([line()])));
      const container = (await readBack(applied.workbook))
        .getRow(2)
        .getCell(COLUMN.containerNumber);

      expect(applied.result.rows[0]).toMatchObject({
        status: "MATCHED",
        containerCorrection: null,
      });
      expect(applied.result.summary.containerCorrected).toBe(0);
      expect(container.value).toBe("EUCU 4591789");
      expect(container.font?.color?.argb).not.toBe(RED);
      expect(container.font).toMatchObject({ bold: true });
    });
  });
});
