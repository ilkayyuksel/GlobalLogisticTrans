import ExcelJS from "exceljs";
import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { reliablyPriced } from "./__fixtures__/invoice-pricing";
import { invoiceReads } from "./__fixtures__/invoice-reads";
import { noRemarks } from "./__fixtures__/invoice-remarks";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import type { MissingTripDto } from "./dto/invoice-missing.dto";

/**
 * What the Remarks of a transport ADDED to the invoice says.
 *
 * ── THE CUSTOMER'S WORDS, AS ON A COMPLETED LINE ────────────────────────────
 * The added line is described with the same facts and the same vocabulary as
 * a line of their own that this check completes: property names in lower
 * case, `tar`, `EC <nr>`, `wachtuur H:MM tot H:MM`, joined by a bare comma.
 * Which words exist is `customer-remark-vocabulary.spec.ts`'s business; this
 * proves the whole chain writes them into the added line, and nothing else.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));
const MISSING_ID = "missing-1";
const REMARKS = 21;
const ADDED_ROW = 3;

const zero = new Prisma.Decimal(0);
const PRICING = reliablyPriced({
  components: [],
  tarief: new Prisma.Decimal("200"),
  brandstof: zero,
  backload: zero,
  tol: zero,
  tunnel: zero,
  others: zero,
  ek: zero,
  totaal: new Prisma.Decimal("200"),
});

/** What the database holds about the missing Trip, beyond the Trip itself. */
interface Facts {
  readonly propertyNames?: string[];
  readonly ccNumbers?: string[];
  readonly tarCharged?: boolean;
  readonly waiting?: { start: string; end: string; endsNextDay?: boolean; minutes?: number };
  /** False: the Trip was never priced, so its price cannot be relied on. */
  readonly priced?: boolean;
}

interface AddedLine {
  readonly remarks: ExcelJS.CellValue;
  readonly dto: MissingTripDto;
  readonly row: ExcelJS.Row;
}

const timeOfDay = (clock: string) => new Date(`1970-01-01T${clock}:00Z`);

describe("the Remarks of a transport added to the invoice", () => {
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  /** Runs the check with ONE missing transport holding the given facts. */
  async function addedLine(facts: Facts): Promise<AddedLine> {
    const missing = {
      id: MISSING_ID,
      status: TripStatus.CLOSED,
      isPaid: false,
      planningDate: MONDAY,
      originalPlanningDate: MONDAY,
      startTime: null,
      bookingNumber: "BELANR2720016",
      containerNumber: "EUCU2451828",
      containerType: "45PH",
      terminal: "Quay 869",
      destinationCity: "MELSELE",
      direction: "DELIVERY",
      tripGroupId: null,
      distanceKm: null,
      waitingTimeStart: facts.waiting ? timeOfDay(facts.waiting.start) : null,
      waitingTimeEnd: facts.waiting ? timeOfDay(facts.waiting.end) : null,
      waitingTimeEndsNextDay: facts.waiting?.endsNextDay ?? false,
      waitingTimeMinutes: facts.waiting?.minutes ?? null,
    };
    const trips = {
      findManyForInvoice: jest.fn().mockResolvedValue([]),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue([missing]),
      setPaidMany: jest.fn(async () => 0),
    };
    const effectivePricing = {
      findForTrips: jest.fn(async () =>
        facts.priced === false ? new Map() : new Map([[MISSING_ID, PRICING]]),
      ),
    };
    const reads = invoiceReads();

    reads.findCustomPropertyNames.mockResolvedValue(
      new Map([[MISSING_ID, facts.propertyNames ?? []]]),
    );
    reads.findCostConfirmationNumbers.mockResolvedValue(
      new Map([[MISSING_ID, facts.ccNumbers ?? []]]),
    );

    const service = buildInvoiceAuditService({
      trips,
      effectivePricing,
      logger,
      reads,
      remarks: noRemarks(reads, facts.tarCharged ? [MISSING_ID] : []),
    });
    const invoice = await buildInvoiceWorkbook({
      lines: [
        {
          planningDate: MONDAY,
          bookingNumber: "DUBANR2718284",
          containerNumber: "EUCU 4581604",
          tarief: 135,
        },
      ],
    });
    const applied = await service.apply({
      buffer: invoice,
      originalname: "week 13 - 2026 GLT.xlsx",
      size: invoice.length,
    });
    const book = new ExcelJS.Workbook();

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    // One line on 2: the added transport opens room at 3, above the totals.
    expect(applied.result.missingTrips[0].rowNumber).toBe(ADDED_ROW);

    const row = book.worksheets[0].getRow(ADDED_ROW);

    return { remarks: row.getCell(REMARKS).value, dto: applied.result.missingTrips[0], row };
  }

  it("names the Trip's Custom Properties in lower case, also those that cost nothing", async () => {
    const line = await addedLine({ propertyNames: ["Aan/Afkoppelen", "Flat"] });

    expect(line.remarks).toBe("aan/afkoppelen,flat");
    expect(line.dto.remarks).toBe("aan/afkoppelen,flat");
  });

  it("writes tar when the Engine charged it", async () => {
    expect((await addedLine({ tarCharged: true })).remarks).toBe("tar");
  });

  it("names every Cost Confirmation the Trip holds as EC", async () => {
    expect((await addedLine({ ccNumbers: ["4208847", "4156173"] })).remarks).toBe(
      "EC 4208847,EC 4156173",
    );
  });

  it("states the waiting window as the customer writes it", async () => {
    expect((await addedLine({ waiting: { start: "08:30", end: "14:00" } })).remarks).toBe(
      "wachtuur 8:30 tot 14:00",
    );
  });

  it("puts everything in the customer's order, comma without space", async () => {
    expect(
      (
        await addedLine({
          propertyNames: ["Aan/Afkoppelen"],
          tarCharged: true,
          ccNumbers: ["4208847"],
          waiting: { start: "08:30", end: "14:00" },
        })
      ).remarks,
    ).toBe("aan/afkoppelen,tar,EC 4208847,wachtuur 8:30 tot 14:00");
  });

  it("says nothing — an empty cell — when the Trip holds none of it", async () => {
    const line = await addedLine({});

    expect(line.remarks).toBeNull();
    expect(line.dto.remarks).toBe("");
  });

  /** A window ending the next day is a stored, valid window: written like any other. */
  it("writes a waiting time over midnight like any other, without a note", async () => {
    const line = await addedLine({ waiting: { start: "22:00", end: "02:00", endsNextDay: true } });

    expect(line.remarks).toBe("wachtuur 22:00 tot 2:00");
    expect(line.dto.remarkNotes).toEqual([]);
  });

  /*
   * A price nobody can stand behind says nothing about what was charged: the
   * properties and tar come from that price. What the Trip simply holds — its
   * confirmations, its waiting window — is still true and still written.
   */
  it("names no property or tar for a Trip whose price cannot be relied on", async () => {
    const line = await addedLine({
      priced: false,
      propertyNames: ["Flat"],
      tarCharged: true,
      ccNumbers: ["4208847"],
    });

    expect(line.remarks).toBe("EC 4208847");
    expect(line.dto.priceReliability.reliable).toBe(false);
  });
});
