import ExcelJS from "exceljs";
import { Prisma, TripDirection, type Trip } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  PROPERTIES,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "../pricing-engine/pricing-lifecycle.harness";
import { DAY_ONE, DAY_TWO, LEG1, LEG2, routeMatchActions } from "../pricing-engine/route-match-lifecycle.fixtures";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { fuelRatesOf } from "./__fixtures__/invoice-pricing";
import { invoiceReads } from "./__fixtures__/invoice-reads";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";

/**
 * The Excel invoice check reads the SAME stored price the Pricing Engine wrote
 * and the Ritten list shows — every component, priced Custom Properties and
 * Over ST included — and compares it component by component. Nothing here is
 * a pricing double: the prices are the snapshots the real Engine stored when
 * the Trips closed (`pricing-lifecycle.harness.ts`).
 */

const COLUMN = { tarief: 12, fuel: 13, backload: 14, tolB: 16, tunnel: 18, others: 19 } as const;
// A Combination's two legs carry one container, as every real pair does.
const CONTAINERS: Record<string, string> = { trip: "EUCU4541197", [LEG1]: "EUCU4541198", [LEG2]: "EUCU4541198" };

describe("the invoice check and the Pricing Engine agree", () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  /** The invoice line of a Trip, stating `amounts` as the customer wrote them. */
  function lineOf(tripId: string, amounts: Partial<InvoiceFixtureLine>, combination = false): InvoiceFixtureLine {
    const trip = world.trips.get(tripId)!;

    return {
      planningDate: trip.planningDate!,
      bookingNumber: trip.bookingNumber!,
      containerNumber: `${CONTAINERS[tripId].slice(0, 4)} ${CONTAINERS[tripId].slice(4)}`,
      ...(combination
        ? trip.direction === TripDirection.DELIVERY
          ? { endPoint: "COMBINATION " }
          : { startPoint: "COMBINATION " }
        : {}),
      ...amounts,
    };
  }

  async function check(tripIds: readonly string[], lines: readonly InvoiceFixtureLine[]) {
    const trips = tripIds.map((id) => world.trips.get(id)!) as Trip[];
    const reads = invoiceReads();
    // The group sizes as the stored Trips state them.
    reads.countGroupMembers.mockImplementation(async (groupIds: readonly string[]) =>
      new Map(
        groupIds.map((groupId) => [
          groupId,
          [...world.trips.values()].filter((trip) => trip.tripGroupId === groupId).length,
        ]),
      ),
    );
    const service = buildInvoiceAuditService({
      logger,
      reads,
      trips: {
        findManyForInvoice: jest.fn().mockResolvedValue(trips),
        findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      },
      // The Ritten list's own read of the stored snapshots.
      effectivePricing: world.effectivePricing,
      fuelRates: fuelRatesOf(new Prisma.Decimal(15)),
    });
    const file = await buildInvoiceWorkbook({ lines, fuelPercentage: 15 });
    const applied = await service.apply({ buffer: file, originalname: "week 36 - 2026 GLT.xlsx", size: file.length });
    const book = new ExcelJS.Workbook();

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    const cell = (row: number, column: number) => book.worksheets[0].getRow(row).getCell(column).value;

    return { rows: applied.result.rows, cell };
  }

  describe("priced Custom Properties", () => {
    /** Tarief 200, Fuel 30, Others: TAR 20 + Flat 45 + Genset 35 = 100. */
    async function closedWithProperties() {
      world.seed(buildTrip("trip", { tarNummer: "TAR-1", containerNumber: CONTAINERS.trip }));
      world.seedAutomaticFlat("trip");
      await world.customValues.assign({ tripId: "trip", customPropertyId: PROPERTIES.genset.id });
      await actions.close("trip");

      expect(await actions.apiPricing("trip")).toMatchObject({ tarief: "200.00", brandstof: "30.00", others: "100.00" });
    }

    it("1. does not flag a line that states every priced property", async () => {
      await closedWithProperties();

      const { rows } = await check(["trip"], [lineOf("trip", { tarief: 200, fuel: 30, others: 100 })]);

      expect(rows[0]).toMatchObject({ priceReliability: { reliable: true }, pricingStatus: "MATCHED_NO_CHANGES" });
    });

    it("2. still finds a line that leaves a priced property out, and raises Others alone", async () => {
      await closedWithProperties();

      // Flat missing from the invoice: 55 instead of 100.
      const { rows, cell } = await check(["trip"], [lineOf("trip", { tarief: 200, fuel: 30, others: 55 })]);

      expect(rows[0].pricingStatus).toBe("PRICING_CORRECTED");
      expect(rows[0].differences.filter((difference) => difference.correctedValue !== null)).toEqual([
        expect.objectContaining({ component: "Others", invoiceValue: "55.00", correctedValue: "100.00" }),
      ]);
      expect(cell(2, COLUMN.others)).toBe(100);
      expect(cell(2, COLUMN.tarief)).toBe(200);
    });

    /**
     * 4. Nothing counted twice: the properties are Others, never in the Tarief
     * or the Fuel. A higher Tarief stays, and its Fuel is our 15% of it (45).
     */
    it("4. counts a property once, in Others, never in the Tarief or the Fuel", async () => {
      await closedWithProperties();

      const { rows, cell } = await check(["trip"], [lineOf("trip", { tarief: 300, fuel: 45, others: 100 })]);

      expect(rows[0].pricingStatus).toBe("INVOICE_HIGHER");
      expect(rows[0].differences.map((difference) => difference.component)).toEqual(["Tarief"]);
      expect(cell(2, COLUMN.others)).toBe(100);
    });
  });

  describe("3. Over ST and the €70 on a Combination", () => {
    /**
     * Ghlin 150 out on day one, Mons 120 back on day two with Over ST
     * 40 / 10 / — : the later leg is 120 + 40 + 70 = 230, Toll 10.
     */
    async function closedCombination() {
      actions.configureCombination();
      actions.seedLegs(DAY_TWO);
      for (const [id, container] of [[LEG1, CONTAINERS[LEG1]], [LEG2, CONTAINERS[LEG2]]]) {
        world.trips.set(id, { ...world.trips.get(id)!, containerNumber: container });
      }
      await actions.close(LEG1);
      await actions.close(LEG2);
    }

    it("compares each leg with its own stored components and total", async () => {
      await closedCombination();

      expect(await actions.apiPricing(LEG1)).toMatchObject({
        tarief: "150.00",
        brandstof: "22.50",
        backload: "50.00",
        tol: "0.00",
        totaal: "222.50",
      });
      expect(await actions.apiPricing(LEG2)).toMatchObject({
        tarief: "230.00",
        brandstof: "34.50",
        backload: "50.00",
        tol: "10.00",
        totaal: "324.50",
      });

      const { rows } = await check(
        [LEG1, LEG2],
        [
          lineOf(LEG1, { tarief: 150, fuel: 22.5, backload: 50 }, true),
          lineOf(LEG2, { tarief: 230, fuel: 34.5, backload: 50, tolB: 10 }, true),
        ],
      );

      expect(rows.map((row) => row.pricingStatus)).toEqual(["MATCHED_NO_CHANGES", "MATCHED_NO_CHANGES"]);
    });

    it("raises a later leg invoiced without Over ST and the €70 to the stored amounts", async () => {
      await closedCombination();

      const { rows, cell } = await check(
        [LEG1, LEG2],
        [
          lineOf(LEG1, { tarief: 150, fuel: 22.5, backload: 50 }, true),
          lineOf(LEG2, { tarief: 120, fuel: 18, backload: 50 }, true),
        ],
      );

      expect(rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
      expect(rows[1].pricingStatus).toBe("PRICING_CORRECTED");
      expect(cell(3, COLUMN.tarief)).toBe(230);
      expect(cell(3, COLUMN.tolB)).toBe(10);
    });

    it("finds nothing to raise when both legs share a day", async () => {
      actions.configureCombination();
      actions.seedLegs(DAY_ONE);
      for (const [id, container] of [[LEG1, CONTAINERS[LEG1]], [LEG2, CONTAINERS[LEG2]]]) {
        world.trips.set(id, { ...world.trips.get(id)!, containerNumber: container });
      }
      await actions.close(LEG1);
      await actions.close(LEG2);

      const { rows } = await check(
        [LEG1, LEG2],
        [
          lineOf(LEG1, { tarief: 150, fuel: 22.5, backload: 50 }, true),
          lineOf(LEG2, { tarief: 120, fuel: 18, backload: 50 }, true),
        ],
      );

      expect(rows.map((row) => row.pricingStatus)).toEqual(["MATCHED_NO_CHANGES", "MATCHED_NO_CHANGES"]);
    });
  });
});
