import ExcelJS from "exceljs";
import { CombinationMatchOutcome, Prisma, RouteMatchMethod, TripDirection, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import type { CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import type { RouteMatchView } from "../trip-pricing/route-match-view";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * The system's own route match decides whether the invoice's prices are
 * compared — through the whole check, into the written file.
 *
 * A route the matcher FOUND is relied on however differently the Trip's place
 * and the priced place are spelled (`Eindhout` ↔ `LAAKDAL (EINDHOUT)`); one it
 * did NOT find, could not choose, or never recorded is not, and then nothing on
 * the line is written and the line is yellow.
 */

const MONDAY = new Date(Date.UTC(2026, 9, 5));
const TRIP_ID = "trip-1";
const TARIEF = 12;
const YELLOW = "FFFFFF00";

/** The system's price: Tarief 150 where the invoice states 135. */
function pricedOn(destination: string, method: RouteMatchMethod | null, match: Partial<RouteMatchView> = {}): CurrentTripPricing {
  const zero = new Prisma.Decimal(0);

  return {
    components: [],
    tarief: new Prisma.Decimal(150),
    brandstof: zero,
    backload: zero,
    tol: zero,
    tunnel: zero,
    others: zero,
    ek: zero,
    totaal: new Prisma.Decimal(150),
    routeMatch: {
      method,
      routePricingId: "route-1",
      combinationRouteGroupId: null,
      combinationMatch: null,
      selection: "AUTOMATIC" as const,
      // A snapshot without a recorded match has no legs either.
      legs:
        method === null
          ? []
          : [{ legPosition: null, isPricedLeg: true, routePricingId: "route-1", departure: destination, destination: "Quay 869", method }],
      overSt: null,
      reviewed: null,
      ...match,
    },
  };
}

describe("the stored route match decides whether the prices are compared", () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;

  async function correct(destinationCity: string, pricing: CurrentTripPricing, tripGroupId: string | null = null) {
    const service = buildInvoiceAuditService({
      logger,
      trips: {
        findManyForInvoice: jest.fn().mockResolvedValue([
          {
            id: TRIP_ID,
            status: TripStatus.CLOSED,
            isPaid: false,
            planningDate: MONDAY,
            originalPlanningDate: MONDAY,
            bookingNumber: "ANRDUB2810849",
            containerNumber: "EUCU4541197",
            direction: TripDirection.COLLECTION,
            terminal: "Quay 869",
            destinationCity,
            tripGroupId,
          },
        ]),
        findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      },
      effectivePricing: { findForTrips: jest.fn().mockResolvedValue(new Map([[TRIP_ID, pricing]])) },
    });
    const file = await buildInvoiceWorkbook({
      lines: [{ planningDate: MONDAY, bookingNumber: "ANRDUB2810849", containerNumber: "EUCU 4541197", tarief: 135 }],
    });
    const applied = await service.apply({ buffer: file, originalname: "week 41 - 2026 GLT.xlsx", size: file.length });
    const book = new ExcelJS.Workbook();

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    return { row: applied.result.rows[0], cell: book.worksheets[0].getRow(2).getCell(TARIEF), applied };
  }

  describe("a route the system matched", () => {
    it.each([
      ["Eindhout", "LAAKDAL (EINDHOUT)", RouteMatchMethod.NORMALIZED],
      ["Kallo", "Kallo (Beveren)", RouteMatchMethod.NORMALIZED],
      ["Beveren", "Kallo (Beveren)", RouteMatchMethod.NORMALIZED],
      ["Zemts", "ZEMST", RouteMatchMethod.FUZZY],
    ])("compares and raises %s priced on %s (%s)", async (place, priced, method) => {
      const { row, cell, applied } = await correct(place, pricedOn(priced, method));

      expect(row.priceReliability).toMatchObject({
        reliable: true,
        problem: null,
        route: { matchMethod: method, tripRoute: `${place} → Quay 869`, pricedRoute: `${priced} → Quay 869` },
      });
      expect(row.pricingStatus).toBe("PRICING_CORRECTED");
      expect(cell.value).toBe(150);
      expect(cell.font?.color?.argb).toBe(CORRECTED_TEXT_ARGB);
      expect(applied.result.markedRowNumbers).toEqual([]);
    });
  });

  describe("a route the system did not confirm", () => {
    it.each([
      ["NOT_FOUND", pricedOn("EINDHOUT", RouteMatchMethod.NOT_FOUND), "ROUTE_NOT_FOUND"],
      ["AMBIGUOUS", pricedOn("EINDHOUT", RouteMatchMethod.AMBIGUOUS), "ROUTE_AMBIGUOUS"],
      ["no recorded match", pricedOn("EINDHOUT", null), "METADATA_MISSING"],
    ])("changes no price on a %s match, and marks the line yellow", async (_case, pricing, problem) => {
      const { row, cell, applied } = await correct("Eindhout", pricing);

      expect(row.priceReliability).toMatchObject({ reliable: false, problem });
      expect(row.pricingStatus).toBe("PRICE_UNRELIABLE");
      expect(cell.value).toBe(135);
      expect((cell.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(YELLOW);
      expect(applied.result.payments[0].payable).toBe(false);
    });

    /** One leg found proves nothing about the pair it belongs to. */
    it("changes no price on a grouped Trip whose Combination was not established", async () => {
      const pricing = pricedOn("LAAKDAL (EINDHOUT)", RouteMatchMethod.NORMALIZED, {
        combinationMatch: CombinationMatchOutcome.PAIR_NOT_CONFIGURED,
      });
      const { row, cell } = await correct("Eindhout", pricing, "group-1");

      expect(row.priceReliability).toMatchObject({ reliable: false, problem: "COMBINATION_NOT_PRICED" });
      expect(cell.value).toBe(135);
    });
  });
});
