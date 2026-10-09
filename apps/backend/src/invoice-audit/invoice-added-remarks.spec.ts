import ExcelJS from "exceljs";
import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { SettingNotFoundException } from "../settings/exceptions/setting.exceptions";
import { CostConfirmationReadService } from "../cost-confirmations/cost-confirmation-read.service";
import { SettingsService } from "../settings/settings.service";
import { TripExportLabelsService } from "../trip-export/trip-export-labels.service";
import type { EffectivePricing } from "../trip-pricing/effective-pricing";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { TripRepository } from "../trips/trip.repository";
import { TripService } from "../trips/trip.service";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import { InvoiceAuditService } from "./invoice-audit.service";
import { InvoiceRowMatchingService } from "./matching/invoice-row-matching.service";
import { MissingTripsService } from "./missing/missing-trips.service";
import { InvoicePricingService } from "./pricing/invoice-pricing.service";
import { InvoiceSheetReader } from "./workbook/invoice-sheet.reader";
import { InvoiceSheetWriter } from "./workbook/invoice-sheet.writer";

/**
 * What the Remarks of a transport ADDED to the invoice says.
 *
 * ── THE WHOLE CHAIN IS REAL ─────────────────────────────────────────────────
 * The missing-transport search, the export-words service the browser's Excel
 * exports also use, the vocabulary itself, and the writer. Only the sources of
 * those words are doubled: the Trip as the API describes it, its stored
 * snapshot, and which Custom Property is TAR.
 *
 * Which words exist and in which order is `trip-export-labels.spec.ts`'s
 * business. This proves the added line says THEM — the same words, from the
 * same place — and says nothing the Trip does not hold.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));
const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";
const MISSING_ID = "missing-1";
const REMARKS = 21;

const zero = new Prisma.Decimal(0);
const PRICING: EffectivePricing = {
  components: [],
  tarief: new Prisma.Decimal("200"),
  brandstof: zero,
  backload: zero,
  tol: zero,
  tunnel: zero,
  others: zero,
  ek: zero,
  totaal: new Prisma.Decimal("200"),
};

/** The Trip as the API describes it — what the export words are read from. */
interface DescribedTrip {
  readonly customProperties?: { id: string; name: string; isActive: boolean }[];
  readonly waitingTimeStart?: string | null;
  readonly waitingTimeEnd?: string | null;
  readonly waitingTimeMinutes?: number | null;
  readonly costConfirmation?: { ccNumber: string } | null;
}

/** A stored snapshot line, as far as the words are concerned. */
type Line = [code: string, customPropertyId?: string, description?: string];

describe("the Remarks of a transport added to the invoice", () => {
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  /** Runs the check with ONE missing transport, described and priced as given. */
  async function remarksOfAdded(
    described: DescribedTrip,
    lines: Line[],
    tarConfigured = true,
    confirmationNumbers: string[] = [],
  ): Promise<ExcelJS.CellValue> {
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
    };

    const trips = {
      findManyForInvoice: jest.fn().mockResolvedValue([]),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue([missing]),
      setPaidMany: jest.fn(async () => 0),
    };
    const effective = {
      findForTrips: jest.fn(async (ids: readonly string[]) =>
        new Map(ids.filter((id) => id === MISSING_ID).map((id) => [id, PRICING])),
      ),
    };

    // The three sources of the words — and the real service composing them.
    const tripService = {
      findManyByIds: jest.fn(async () => [
        {
          id: MISSING_ID,
          customProperties: [],
          waitingTimeStart: null,
          waitingTimeEnd: null,
          waitingTimeMinutes: null,
          ...described,
        },
      ]),
    };
    const pricingService = {
      findManyByTripIds: jest.fn(async () => [
        {
          pricing: { tripId: MISSING_ID },
          items: lines.map(([code, customPropertyId, description]) => ({
            pricingComponentCode: code,
            customPropertyId: customPropertyId ?? null,
            description: description ?? code,
          })),
        },
      ]),
    };
    const settings = {
      findOne: jest.fn(async (category: string, key: string) => {
        if (!tarConfigured) {
          throw new SettingNotFoundException(category, key);
        }

        return { value: TAR_ID };
      }),
    };
    // The Trip's Cost Confirmation records — the source of the references.
    const confirmations = {
      findNumbersForTrips: jest.fn(
        async () => new Map([[MISSING_ID, confirmationNumbers]]),
      ),
    };
    const exportLabels = new TripExportLabelsService(
      tripService as unknown as TripService,
      pricingService as unknown as TripPricingService,
      settings as unknown as SettingsService,
      confirmations as unknown as CostConfirmationReadService,
      logger,
    );

    const service = new InvoiceAuditService(
      new InvoiceSheetReader(logger),
      new InvoiceRowMatchingService(trips as unknown as TripRepository, logger),
      new InvoicePricingService(effective as unknown as EffectivePricingService, logger),
      new MissingTripsService(
        trips as unknown as TripRepository,
        effective as unknown as EffectivePricingService,
        exportLabels,
        logger,
      ),
      new InvoiceSheetWriter(logger),
      trips as unknown as TripRepository,
      logger,
    );

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
    expect(applied.result.missingTrips[0].rowNumber).toBe(3);

    return book.worksheets[0].getRow(3).getCell(REMARKS).value;
  }

  /** L — the Trip's own Custom Properties, by their configured names. */
  it("names the Trip's Custom Properties", async () => {
    expect(
      await remarksOfAdded(
        {
          customProperties: [
            { id: "prop-1", name: "Aan/Afkoppelen", isActive: true },
            { id: "prop-flat", name: "Flat", isActive: true },
          ],
        },
        [["BASE_PRICE"], ["CUSTOM_PROPERTY", "prop-1"]],
      ),
    ).toBe("Aan/Afkoppelen | Flat");
  });

  /** M — TAR, when the Engine charged it: read off the stored snapshot. */
  it("names TAR when the Engine charged it", async () => {
    expect(
      await remarksOfAdded({}, [["BASE_PRICE"], ["CUSTOM_PROPERTY", TAR_ID]]),
    ).toBe("TAR");
  });

  /** N — every Cost Confirmation the Trip holds, from its records. */
  it("names every Cost Confirmation the Trip holds", async () => {
    expect(
      await remarksOfAdded(
        {},
        [
          ["BASE_PRICE"],
          ["COST_CONFIRMATION", undefined, "Cost confirmations 4208847, 4156173"],
        ],
        true,
        ["4208847", "4156173"],
      ),
    ).toBe("CC4208847 | CC4156173");
  });

  it("names a confirmation the stored snapshot predates", async () => {
    expect(await remarksOfAdded({}, [["BASE_PRICE"]], true, ["4208847"])).toBe("CC4208847");
  });

  it("states the waiting window", async () => {
    expect(
      await remarksOfAdded(
        { waitingTimeStart: "08:30:00", waitingTimeEnd: "14:00:00", waitingTimeMinutes: 330 },
        [["BASE_PRICE"], ["WAITING_TIME"]],
      ),
    ).toBe("Wachttijd 08:30-14:00");
  });

  it("puts everything in the exports' own order", async () => {
    expect(
      await remarksOfAdded(
        {
          customProperties: [{ id: "prop-1", name: "Aan/Afkoppelen", isActive: true }],
          waitingTimeStart: "08:30:00",
          waitingTimeEnd: "14:00:00",
          waitingTimeMinutes: 330,
        },
        [
          ["BASE_PRICE"],
          ["CUSTOM_PROPERTY", TAR_ID],
          ["WAITING_TIME"],
          ["COST_CONFIRMATION", undefined, "Cost confirmation 4208847"],
        ],
        true,
        ["4208847"],
      ),
    ).toBe("Aan/Afkoppelen | TAR | Wachttijd 08:30-14:00 | CC4208847");
  });

  /** O — nothing the Trip does not hold: no TAR, no CC, an empty cell. */
  it("says nothing — an empty cell — when the Trip holds none of it", async () => {
    expect(await remarksOfAdded({}, [["BASE_PRICE"]])).toBeNull();
  });

  it("names no TAR when the charge was withheld", async () => {
    expect(
      await remarksOfAdded({ customProperties: [{ id: "p", name: "Flat", isActive: true }] }, [["BASE_PRICE"]]),
    ).toBe("Flat");
  });

  /** A deployment with no TAR setting yet: nothing can be recognised as TAR. */
  it("names no TAR when the TAR setting is not configured", async () => {
    expect(
      await remarksOfAdded({}, [["BASE_PRICE"], ["CUSTOM_PROPERTY", TAR_ID]], false),
    ).toBeNull();
  });
});
