import ExcelJS from "exceljs";
import { CombinationMatchOutcome, Prisma, RouteMatchMethod, TripDirection, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import type { CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import type { RouteMatchLegView, RouteMatchView } from "../trip-pricing/route-match-view";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { invoiceReads } from "./__fixtures__/invoice-reads";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import type { RouteChoiceMember } from "./invoice-audit-read.repository";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * A route an operator chose in the Ritten list, through the whole invoice check
 * and into the written file (owner, 20 October 2026).
 *
 * The automatic NOT_FOUND or AMBIGUOUS the choice was made for is no reason to
 * distrust the price — as long as what is stored NOW confirms it: the choice
 * still stands, the route still exists, and a chosen Combination is held by
 * both legs. A real price difference is still found and corrected; a choice a
 * later reprocess removed is never used.
 */

const MONDAY = new Date(Date.UTC(2026, 9, 5));
const TRIP_ID = "trip-1";
const PARTNER_ID = "trip-2";
const GROUP_ID = "group-1";
const DOCUMENT_ID = "pdf-1";
const ROW = 2;
const TARIEF = 12;
const YELLOW = "FFFFFF00";
const zero = new Prisma.Decimal(0);

/** A stored price on a route chosen by hand: Tarief 150 where the invoice says 135. */
function manuallyPriced(match: Partial<RouteMatchView> = {}, tarief = 150): CurrentTripPricing {
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
    routeMatch: {
      method: RouteMatchMethod.NOT_FOUND,
      routePricingId: "route-1",
      combinationRouteGroupId: null,
      combinationMatch: null,
      selection: "MANUAL" as const,
      legs: [
        { legPosition: null, isPricedLeg: true, routePricingId: "route-1", departure: "Quay 869", destination: "LILLE", method: RouteMatchMethod.NOT_FOUND },
      ],
      overSt: null,
      reviewed: false,
      ...match,
    },
  };
}

function legs(pricedLeg: string): RouteMatchLegView[] {
  return [
    { legPosition: 1, isPricedLeg: pricedLeg === "leg-1", routePricingId: "leg-1", departure: "Quay 869", destination: "LILLE", method: RouteMatchMethod.NOT_FOUND },
    { legPosition: 2, isPricedLeg: pricedLeg === "leg-2", routePricingId: "leg-2", departure: "LILLE", destination: "Quay 869", method: RouteMatchMethod.NOT_FOUND },
  ];
}

/** One leg of a Combination chosen by hand, with the €50 Backload of its group. */
function chosenLeg(pricedLeg: string, combinationRouteGroupId = "combination-1"): CurrentTripPricing {
  return {
    ...manuallyPriced({
      routePricingId: pricedLeg,
      combinationRouteGroupId,
      combinationMatch: CombinationMatchOutcome.PAIR_NOT_CONFIGURED,
      legs: legs(pricedLeg),
    }),
    backload: new Prisma.Decimal(50),
    totaal: new Prisma.Decimal(200),
  };
}

function member(id: string, currentChoice: string | null, grouped: boolean): RouteChoiceMember {
  return {
    id,
    tripGroupId: grouped ? GROUP_ID : null,
    pdfDocumentId: DOCUMENT_ID,
    direction: id === TRIP_ID ? TripDirection.DELIVERY : TripDirection.COLLECTION,
    status: TripStatus.CLOSED,
    currentChoice,
  };
}

describe("a route chosen by hand, in the Excel invoice check", () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;

  /**
   * The invoice line of TRIP_ID (Tarief 135, Backload as given), checked against
   * the stored prices and the route choices stored NOW. The partner leg is not
   * on the invoice: its stored price is read for the check alone.
   */
  async function check(input: {
    pricing: ReadonlyMap<string, CurrentTripPricing>;
    choices: readonly RouteChoiceMember[];
    grouped?: boolean;
    backload?: number;
  }) {
    const reads = invoiceReads();
    reads.findRouteChoiceMembers.mockResolvedValue([...input.choices]);
    const findForTrips = jest.fn(async (ids: readonly string[]) =>
      new Map(ids.flatMap((id) => (input.pricing.has(id) ? [[id, input.pricing.get(id)!] as const] : []))),
    );
    const service = buildInvoiceAuditService({
      logger,
      reads,
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
            direction: TripDirection.DELIVERY,
            terminal: "Quay 869",
            destinationCity: "Lille",
            tripGroupId: input.grouped ? GROUP_ID : null,
            pdfDocumentId: DOCUMENT_ID,
          },
        ]),
        findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      },
      effectivePricing: { findForTrips },
    });
    const file = await buildInvoiceWorkbook({
      lines: [
        {
          planningDate: MONDAY,
          bookingNumber: "ANRDUB2810849",
          containerNumber: "EUCU 4541197",
          tarief: 135,
          ...(input.backload === undefined ? {} : { backload: input.backload }),
        },
      ],
    });
    const applied = await service.apply({ buffer: file, originalname: "week 41 - 2026 GLT.xlsx", size: file.length });
    const book = new ExcelJS.Workbook();

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    const sheet = book.worksheets[0];

    return { row: applied.result.rows[0], cell: sheet.getRow(ROW).getCell(TARIEF), applied, findForTrips };
  }

  const ordinary = (pricing: CurrentTripPricing, currentChoice: string | null = "route-1") =>
    check({ pricing: new Map([[TRIP_ID, pricing]]), choices: [member(TRIP_ID, currentChoice, false)] });

  const expectCorrected = (outcome: Awaited<ReturnType<typeof check>>) => {
    expect(outcome.row.priceReliability).toMatchObject({ reliable: true, problem: null });
    expect(outcome.row.pricingStatus).toBe("PRICING_CORRECTED");
    expect(outcome.cell.value).toBe(150);
    expect(outcome.cell.font?.color?.argb).toBe(CORRECTED_TEXT_ARGB);
    expect(outcome.applied.result.markedRowNumbers).toEqual([]);
  };

  const expectUntouched = (outcome: Awaited<ReturnType<typeof check>>, problem: string) => {
    expect(outcome.row.priceReliability).toMatchObject({ reliable: false, problem });
    expect(outcome.row.pricingStatus).toBe("PRICE_UNRELIABLE");
    expect(outcome.cell.value).toBe(135);
    expect(outcome.applied.result.markedRowNumbers).toEqual([ROW]);
  };

  describe("an ordinary route", () => {
    /** 1 and 3: accepted, and the real difference (135 → 150) still corrected. */
    it("1/3. accepts a choice made after NOT_FOUND, and still corrects the price", async () => {
      expectCorrected(await ordinary(manuallyPriced()));
    });

    it("2. accepts a choice made after AMBIGUOUS", async () => {
      expectCorrected(await ordinary(manuallyPriced({ method: RouteMatchMethod.AMBIGUOUS })));
    });

    it("finds no difference where there is none", async () => {
      const { row, cell } = await ordinary(manuallyPriced({}, 135));

      expect(row.pricingStatus).toBe("MATCHED_NO_CHANGES");
      expect(cell.value).toBe(135);
    });

    it("4. does not accept a choice whose route configuration was removed", async () => {
      // Removing the configuration removes the choice with it (ON DELETE CASCADE).
      expectUntouched(await ordinary(manuallyPriced({ reviewed: null }), null), "MANUAL_ROUTE_REMOVED");
    });

    /** 7. An explicit reprocess removed the choice; its own pricing then failed. */
    it("7. uses only the current situation: a choice since removed vouches for nothing", async () => {
      expectUntouched(await ordinary(manuallyPriced(), null), "SNAPSHOT_INCONSISTENT");
    });

    it("7. and follows the automatic snapshot that replaced the choice", async () => {
      const automatic = manuallyPriced({ selection: "AUTOMATIC", method: RouteMatchMethod.NOT_FOUND });

      expectUntouched(await ordinary(automatic, null), "ROUTE_NOT_FOUND");
    });
  });

  describe("a Combination chosen by hand", () => {
    const pair = (partnerPricing: CurrentTripPricing | null, partnerChoice: string | null = "leg-2") =>
      check({
        grouped: true,
        backload: 50,
        pricing: new Map([
          [TRIP_ID, chosenLeg("leg-1")],
          ...(partnerPricing ? [[PARTNER_ID, partnerPricing] as const] : []),
        ]),
        choices: [member(TRIP_ID, "leg-1", true), member(PARTNER_ID, partnerChoice, true)],
      });

    it("6. accepts both legs on one Combination, and the check runs as ever", async () => {
      const outcome = await pair(chosenLeg("leg-2"));

      expectCorrected(outcome);
      // The partner leg is not on the invoice: its stored price is read for the check.
      expect(outcome.findForTrips).toHaveBeenCalledWith([PARTNER_ID]);
    });

    it.each<[string, CurrentTripPricing | null, string | null]>([
      ["a partner leg without a price", null, "leg-2"],
      ["a partner leg whose choice was removed", chosenLeg("leg-2"), null],
      ["a partner leg on another Combination", chosenLeg("leg-2", "combination-2"), "leg-2"],
      ["a partner leg on the same leg", chosenLeg("leg-1"), "leg-1"],
    ])("5. does not accept %s", async (_name, partnerPricing, partnerChoice) => {
      expectUntouched(await pair(partnerPricing, partnerChoice), "COMBINATION_NOT_PRICED");
    });

    it("5. does not accept legs that are not complementary", async () => {
      const outcome = await check({
        grouped: true,
        backload: 50,
        pricing: new Map([
          [TRIP_ID, { ...chosenLeg("leg-1"), routeMatch: { ...chosenLeg("leg-1").routeMatch, legs: legs("leg-1").map((leg) => ({ ...leg, legPosition: 1 })) } }],
          [PARTNER_ID, chosenLeg("leg-2")],
        ]),
        choices: [member(TRIP_ID, "leg-1", true), member(PARTNER_ID, "leg-2", true)],
      });

      expectUntouched(outcome, "SNAPSHOT_INCONSISTENT");
    });

    it("colours the line it cannot rely on yellow", async () => {
      const { applied } = await pair(null);
      const book = new ExcelJS.Workbook();

      await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

      const fill = book.worksheets[0].getRow(ROW).getCell(TARIEF).fill as ExcelJS.FillPattern;

      expect(fill.fgColor?.argb).toBe(YELLOW);
    });
  });
});
