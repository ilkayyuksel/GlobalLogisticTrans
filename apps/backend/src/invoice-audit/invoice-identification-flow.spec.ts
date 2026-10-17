import ExcelJS from "exceljs";
import { Prisma, Trip } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import type { CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { reliablyPriced } from "./__fixtures__/invoice-pricing";
import { invoiceReads, type InvoiceReadsDouble } from "./__fixtures__/invoice-reads";
import { tripRecord } from "./__fixtures__/invoice-rows";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { InvoiceAuditService } from "./invoice-audit.service";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";

/**
 * Phase 2 through the whole check: the corrected workbook read back from its
 * bytes, and what the run would settle. The lines are shaped like week 41's.
 */

const TUESDAY = new Date(Date.UTC(2026, 9, 6));
const COLUMN = { booking: 5, container: 6, tarief: 12, backload: 14, ek: 20 } as const;
const RED = "FFFF0000";

function pricing(amounts: Record<string, string>): CurrentTripPricing {
  const of = (key: string) => new Prisma.Decimal(amounts[key] ?? "0");

  return reliablyPriced({
    components: [],
    tarief: of("tarief"),
    brandstof: of("brandstof"),
    backload: of("backload"),
    tol: of("tol"),
    tunnel: of("tunnel"),
    others: of("others"),
    ek: of("ek"),
    totaal: of("totaal"),
  });
}

const onTuesday = (overrides: Partial<Trip>) =>
  tripRecord({ planningDate: TUESDAY, originalPlanningDate: TUESDAY, ...overrides });

function line(overrides: Partial<InvoiceFixtureLine>): InvoiceFixtureLine {
  return { planningDate: TUESDAY, bookingNumber: "", containerNumber: "", ...overrides };
}

/** A Cost Confirmation line, as week 41 R53 states it. */
function costLine(bookingNumber: string, ek: number, ccNumber: string): InvoiceFixtureLine {
  return line({
    bookingNumber,
    containerNumber: "",
    tarief: null,
    ek,
    remarks: `EC ${ccNumber}`,
    containerType: null,
    startPoint: null,
    endPoint: null,
  });
}

describe("identifying the lines of a weekly invoice", () => {
  let trips: { findManyForInvoice: jest.Mock; findClosedUnpaidBetween: jest.Mock; setPaidMany: jest.Mock };
  let reads: InvoiceReadsDouble;
  let pricingByTrip: Map<string, CurrentTripPricing>;
  let service: InvoiceAuditService;

  beforeEach(() => {
    trips = {
      findManyForInvoice: jest.fn().mockResolvedValue([]),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      setPaidMany: jest.fn(async (ids: readonly string[]) => ids.length),
    };
    reads = invoiceReads();
    pricingByTrip = new Map();

    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;
    const effective = {
      findForTrips: jest.fn(async (ids: readonly string[]) =>
        new Map(ids.filter((id) => pricingByTrip.has(id)).map((id) => [id, pricingByTrip.get(id)!])),
      ),
    } as unknown as EffectivePricingService;

    service = buildInvoiceAuditService({
      trips,
      effectivePricing: effective,
      logger,
      reads,
    });
  });

  async function apply(lines: InvoiceFixtureLine[]) {
    return applyTo(await buildInvoiceWorkbook({ lines }));
  }

  async function applyTo(file: Buffer) {
    const applied = await service.apply({ buffer: file, originalname: "week 41 - 2026 GLT.xlsx", size: file.length });
    const book = new ExcelJS.Workbook();

    lastPayments = applied.result.payments;

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    return { applied, sheet: book.worksheets[0] };
  }

  let lastPayments: readonly { tripId: string; payable: boolean }[] = [];

  /** What the last run's preview offers for payment. */
  const paid = () => lastPayments.filter((payment) => payment.payable).map((payment) => payment.tripId);

  describe("Cost Confirmation lines without their transport (week 41 R53–R54)", () => {
    const bousbecque = onTuesday({
      id: "bousbecque",
      bookingNumber: "ANRDUB2812770",
      containerNumber: "TLLU1609235",
    });

    beforeEach(() => {
      reads.findCostConfirmationsByNumbers.mockResolvedValue([
        { tripId: "bousbecque", ccNumber: "4220981", amount: new Prisma.Decimal("110") },
        { tripId: "bousbecque", ccNumber: "4220982", amount: new Prisma.Decimal("70") },
      ]);
      reads.findTripsByIds.mockResolvedValue([bousbecque]);
      pricingByTrip.set("bousbecque", pricing({ tarief: "299", ek: "180" }));
      // The transport itself is finished and unpaid in this week.
      trips.findClosedUnpaidBetween.mockResolvedValue([bousbecque]);
    });

    async function week() {
      return apply([
        line({ bookingNumber: "ANRDUB2810849", containerNumber: "EUCU 4541197", tarief: 229 }),
        costLine("ANRDUB2812770", 110, "4220981"),
        costLine("ANRDUB2812770", 70, "4220982"),
      ]);
    }

    it("resolves each to its confirmation and leaves its EK alone when it agrees", async () => {
      const { applied, sheet } = await week();

      expect(applied.result.rows.slice(1).map((row) => [row.status, row.pricingStatus])).toEqual([
        ["COST_LINE", "MATCHED_NO_CHANGES"],
        ["COST_LINE", "MATCHED_NO_CHANGES"],
      ]);
      expect(sheet.getRow(3).getCell(COLUMN.ek).value).toBe(110);
      expect(sheet.getRow(3).getCell(COLUMN.tarief).value).toBeNull();
    });

    it("does not add the transport they belong to a second time", async () => {
      const { applied } = await week();

      expect(applied.result.missingTrips).toEqual([]);
      expect(applied.rowsAdded).toBe(0);
    });

    it("never settles the transport on its Cost Confirmation lines alone", async () => {
      await week();

      expect(paid()).not.toContain("bousbecque");
    });
  });

  describe("a Combination the Excel marks", () => {
    /** Week 13 R23–R24: the invoice charges a Combination nobody grouped. */
    function aPair() {
      trips.findManyForInvoice.mockResolvedValue([
        onTuesday({ id: "leg-1", bookingNumber: "DUBANR2707257", containerNumber: "CNEU4580982" }),
        onTuesday({ id: "leg-2", bookingNumber: "ANRCRK2725131", containerNumber: "CNEU4580982" }),
      ]);
      pricingByTrip.set("leg-1", pricing({ tarief: "155" }));
      pricingByTrip.set("leg-2", pricing({ tarief: "155" }));

      return apply([
        line({ bookingNumber: "DUBANR2707257", containerNumber: "CNEU 4580982", tarief: 80, backload: 50, endPoint: "COMBINATION " }),
        line({ bookingNumber: "ANRCRK2725131", containerNumber: "CNEU 4580982", tarief: 90, backload: 50, startPoint: "COMBINATION " }),
      ]);
    }

    it("is GEEN COMBI: the Backload goes and the Tarief goes up, on both lines", async () => {
      const { applied, sheet } = await aPair();

      expect(applied.result.rows.map((row) => row.combination?.verdict)).toEqual(["GEEN_COMBI", "GEEN_COMBI"]);
      for (const rowNumber of [2, 3]) {
        expect(sheet.getRow(rowNumber).getCell(COLUMN.backload).value).toBeNull();
        expect(sheet.getRow(rowNumber).getCell(COLUMN.tarief).value).toBe(155);
      }
      expect(applied.result.summary.geenCombi).toBe(2);
    });

    it("leaves a pair it cannot confirm untouched, and marks both lines", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        onTuesday({ id: "leg-1", bookingNumber: "DUBANR2707257", containerNumber: "CNEU4580982", tripGroupId: "group-1" }),
        onTuesday({ id: "leg-2", bookingNumber: "ANRCRK2725131", containerNumber: "CNEU4580982" }),
      ]);
      pricingByTrip.set("leg-1", pricing({ tarief: "155", backload: "50" }));
      pricingByTrip.set("leg-2", pricing({ tarief: "155" }));

      const { applied, sheet } = await apply([
        line({ bookingNumber: "DUBANR2707257", containerNumber: "CNEU 4580982", tarief: 80, backload: 50, endPoint: "COMBINATION " }),
        line({ bookingNumber: "ANRCRK2725131", containerNumber: "CNEU 4580982", tarief: 90, backload: 50, startPoint: "COMBINATION " }),
      ]);

      expect(applied.result.rows.map((row) => row.pricingStatus)).toEqual(["COMBINATION_REVIEW", "COMBINATION_REVIEW"]);
      expect(sheet.getRow(2).getCell(COLUMN.backload).value).toBe(50);
      expect(applied.rowsMarked).toBe(2);
      expect(paid()).toEqual([]);
    });
  });

  describe("a misprinted booking number", () => {
    it("is corrected in red and the transport is settled", async () => {
      reads.findTripsOnDates.mockResolvedValue([onTuesday({ id: "amandsberg" })]);
      pricingByTrip.set("amandsberg", pricing({ tarief: "229" }));

      const { applied, sheet } = await apply([
        line({ bookingNumber: "ANRDUB2810000", containerNumber: "EUCU 4541197", tarief: 229 }),
      ]);
      const cell = sheet.getRow(2).getCell(COLUMN.booking);

      expect(cell.value).toBe("ANRDUB2810849");
      expect(cell.font?.color?.argb).toBe(RED);
      expect(applied.result.rows[0].bookingCorrection).toEqual({
        invoiceBookingNumber: "ANRDUB2810000",
        tripBookingNumber: "ANRDUB2810849",
      });
      expect(paid()).toEqual(["amandsberg"]);
    });
  });

  describe("a transport a line could be", () => {
    it("is not added but reported beside the line that blocks it", async () => {
      // The line misprints its DATE: it matches nothing, but names the booking.
      trips.findClosedUnpaidBetween.mockResolvedValue([onTuesday({ id: "amandsberg" })]);

      const { applied } = await apply([
        line({
          planningDate: new Date(Date.UTC(2026, 9, 7)),
          bookingNumber: "ANRDUB2810849",
          containerNumber: "EUCU 4541197",
          tarief: 229,
        }),
      ]);

      expect(applied.rowsAdded).toBe(0);
      expect(applied.result.blockedMissingTrips).toEqual([
        expect.objectContaining({ tripId: "amandsberg", blockingRowNumbers: [2] }),
      ]);
      expect(applied.result.summary.blockedMissingTrips).toBe(1);
    });
  });

  /**
   * ── PHASE 3: WHAT THE DOCUMENT SHOWS ─────────────────────────────────────
   * Red text on exactly what changed, Remarks completed in the customer's own
   * words, a whole yellow row for what somebody has to look at — and a second
   * run over the corrected file changes nothing.
   */
  describe("what the corrected document shows", () => {
    const REMARKS = 21;
    const fontOf = (sheet: ExcelJS.Worksheet, row: number, column: number) =>
      sheet.getRow(row).getCell(column).font?.color?.argb;

    function aGeenCombiPair() {
      trips.findManyForInvoice.mockResolvedValue([
        onTuesday({ id: "leg-1", bookingNumber: "DUBANR2707257", containerNumber: "CNEU4580982" }),
        onTuesday({ id: "leg-2", bookingNumber: "ANRCRK2725131", containerNumber: "CNEU4580982" }),
      ]);
      pricingByTrip.set("leg-1", pricing({ tarief: "155" }));
      pricingByTrip.set("leg-2", pricing({ tarief: "155" }));
      reads.findCustomPropertyNames.mockResolvedValue(new Map([["leg-2", ["TAR"]]]));

      return [
        line({ bookingNumber: "DUBANR2707257", containerNumber: "CNEU 4580982", tarief: 80, backload: 50, endPoint: "COMBINATION " }),
        line({ bookingNumber: "ANRCRK2725131", containerNumber: "CNEU 4580982", tarief: 90, backload: 50, startPoint: "COMBINATION ", remarks: "tar  " }),
      ];
    }

    it("writes GEEN COMBI into both lines' Remarks, in red", async () => {
      const { applied, sheet } = await apply(aGeenCombiPair());

      expect(sheet.getRow(2).getCell(REMARKS).value).toBe("GEEN COMBI");
      expect(sheet.getRow(3).getCell(REMARKS).value).toBe("tar,GEEN COMBI");
      expect(fontOf(sheet, 2, REMARKS)).toBe(RED);
      expect(applied.result.rows[1].remarks).toMatchObject({ before: "tar  ", added: ["GEEN COMBI"] });
    });

    it("turns a raised and a removed amount red, and leaves the rest alone", async () => {
      const { sheet } = await apply(aGeenCombiPair());

      expect(fontOf(sheet, 2, COLUMN.tarief)).toBe(RED);
      expect(fontOf(sheet, 2, COLUMN.backload)).toBe(RED);
      expect(fontOf(sheet, 2, COLUMN.booking)).not.toBe(RED);
      expect(fontOf(sheet, 2, COLUMN.ek)).not.toBe(RED);
    });

    it("changes nothing when the corrected file is checked again", async () => {
      const first = await apply(aGeenCombiPair());
      const again = await applyTo(first.applied.workbook);

      expect(again.applied.cellsWritten).toBe(0);
      expect(again.applied.result.rows.map((row) => row.remarks)).toEqual([null, null]);
      expect(again.sheet.getRow(3).getCell(REMARKS).value).toBe("tar,GEEN COMBI");
    });

    it("marks a line for review yellow from its first column to Remarks", async () => {
      const { sheet } = await apply([
        line({ bookingNumber: "ANRDUB0000000", containerNumber: "EUCU 0000000", tarief: 229 }),
      ]);

      for (let column = 1; column <= REMARKS; column += 1) {
        expect((sheet.getRow(2).getCell(column).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb).toBe(
          "FFFFFF00",
        );
      }
    });
  });
});
