import ExcelJS from "exceljs";
import { Prisma, TripStatus, type Trip } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { buildPricingLifecycle, buildTrip, type PricingLifecycle } from "../pricing-engine/pricing-lifecycle.harness";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { fuelRatesOf } from "./__fixtures__/invoice-pricing";
import { noRemarks } from "./__fixtures__/invoice-remarks";
import { invoiceReads } from "./__fixtures__/invoice-reads";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";

/**
 * EK: the waiting time OR the Cost Confirmations, never both — from the
 * waiting window a person types, through the real Engine and the stored
 * snapshot, to the Excel invoice check reading that same stored price.
 *
 * ── THE RULE (`resolveEk`, `CostConfirmationCalculator`) ────────────────────
 *   waiting time charged (> €0)   → the EK; the confirmations stay stored and
 *                                   named, and their line is stored at €0
 *   waiting time €0, or none      → the confirmations, each number once, summed
 * The waiting time is never in Others.
 *
 * ── THE NUMBERS (the Settings' defaults, as the harness holds them) ─────────
 * Only 06:00 → 20:00 counts. From 150 minutes on, 120 are free and every
 * started 15 minutes costs €13.75. Tarief 200, Fuel 15% = 30.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TRIP = "trip";
const CONTAINER = "EUCU4541197";
const COLUMN = { tarief: 12, fuel: 13, others: 19, ek: 20, remarks: 21 } as const;

/** 180 counted minutes → 60 billable → 4 blocks → 55.00. */
const CHARGED = { waitingTimeStart: "10:00", waitingTimeEnd: "13:00" };
/** 135 counted minutes: below the threshold, so €0. */
const BELOW_THRESHOLD = { waitingTimeStart: "10:00", waitingTimeEnd: "12:15" };
/** Entirely at night: nothing of it counts. */
const AT_NIGHT = { waitingTimeStart: "22:00", waitingTimeEnd: "02:00", waitingTimeEndsNextDay: true };

describe("waiting time and Cost Confirmations: one EK, the same in the Engine and the invoice check", () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;
  let world: PricingLifecycle;

  beforeEach(async () => {
    world = buildPricingLifecycle();
    world.seed(buildTrip(TRIP, { containerNumber: CONTAINER }));
    await world.tripService.changeStatus(TRIP, { status: TripStatus.CLOSED });
  });

  const apiPricing = async () => (await world.readTrip(TRIP)).pricing!;

  /** The stored snapshot's items, summed per component, as fixed-2 text. */
  function storedComponents(): Record<string, string> {
    const sums: Record<string, Prisma.Decimal> = {};

    for (const item of world.storedSnapshot(TRIP)!.items) {
      const code = item.pricingComponent.code;
      sums[code] = (sums[code] ?? new Prisma.Decimal(0)).plus(item.amount);
    }

    return Object.fromEntries(Object.entries(sums).map(([code, sum]) => [code, sum.toFixed(2)]));
  }

  function transportLine(amounts: Partial<InvoiceFixtureLine>): InvoiceFixtureLine {
    const trip = world.trips.get(TRIP)!;

    return {
      planningDate: trip.planningDate!,
      bookingNumber: trip.bookingNumber!,
      containerNumber: `${CONTAINER.slice(0, 4)} ${CONTAINER.slice(4)}`,
      tarief: 200,
      fuel: 30,
      ...amounts,
    };
  }

  /** A Cost Confirmation line as the customer writes one: an EK and `EC <nr>`. */
  function costLine(ek: number, ccNumber: string): InvoiceFixtureLine {
    return {
      planningDate: world.trips.get(TRIP)!.planningDate!,
      bookingNumber: world.trips.get(TRIP)!.bookingNumber!,
      containerNumber: "",
      tarief: null,
      ek,
      remarks: `EC ${ccNumber}`,
      containerType: null,
      startPoint: null,
      endPoint: null,
    };
  }

  /** The invoice check over the stored price and the stored confirmations. */
  async function check(lines: readonly InvoiceFixtureLine[]) {
    const reads = invoiceReads();
    const confirmations = () => world.costConfirmations.filter((row) => row.tripId === TRIP);

    reads.findCostConfirmationsByNumbers.mockImplementation(async (numbers) =>
      confirmations()
        .filter((row) => numbers.includes(row.ccNumber))
        .map((row) => ({ tripId: row.tripId, ccNumber: row.ccNumber, amount: row.amount })),
    );
    reads.findTripsByIds.mockImplementation(async (ids) => ids.map((id) => world.trips.get(id)!).filter(Boolean));
    reads.findCostConfirmationNumbers.mockImplementation(
      async () => new Map([[TRIP, [...new Set(confirmations().map((row) => row.ccNumber))]]]),
    );
    const service = buildInvoiceAuditService({
      logger,
      reads,
      remarks: noRemarks(reads),
      trips: {
        findManyForInvoice: jest.fn().mockResolvedValue([world.trips.get(TRIP)] as Trip[]),
        findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      },
      effectivePricing: world.effectivePricing,
      fuelRates: fuelRatesOf(new Prisma.Decimal(15)),
    });
    const file = await buildInvoiceWorkbook({ lines, fuelPercentage: 15 });
    const applied = await service.apply({ buffer: file, originalname: "week 36 - 2026 GLT.xlsx", size: file.length });
    const book = new ExcelJS.Workbook();

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    return {
      rows: applied.result.rows,
      cell: (row: number, column: number) => book.worksheets[0].getRow(row).getCell(column).value,
    };
  }

  describe("1. a charged waiting time beside a confirmation", () => {
    beforeEach(async () => {
      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.tripService.update(TRIP, CHARGED);
    });

    it("is the EK; the confirmation is stored at €0 and kept", async () => {
      expect(await apiPricing()).toMatchObject({ ek: "55.00", others: "0.00", totaal: "285.00" });
      expect(storedComponents()).toMatchObject({ WAITING_TIME: "55.00", COST_CONFIRMATION: "0.00" });
      expect(world.storedSnapshot(TRIP)!.totalPrice.toFixed(2)).toBe("285.00");
      expect(world.costConfirmations.map((row) => [row.ccNumber, row.amount.toFixed(2)])).toEqual([["4132482", "25.00"]]);
    });

    it("leaves a line charging the waiting time as EK alone", async () => {
      const { rows } = await check([transportLine({ ek: 55 })]);

      expect(rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
    });

    it("never raises the EK to the waiting time plus the confirmation", async () => {
      const { rows, cell } = await check([transportLine({ ek: 25 })]);

      expect(rows[0].differences.filter((difference) => difference.correctedValue !== null)).toEqual([
        expect.objectContaining({ component: "EK", invoiceValue: "25.00", correctedValue: "55.00" }),
      ]);
      expect(cell(2, COLUMN.ek)).toBe(55);
    });

    it("owes nothing on a separate EC line, and does not raise the transport for it", async () => {
      const { rows, cell } = await check([transportLine({ ek: 55 }), costLine(25, "4132482")]);

      expect(rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
      // Compared with €0, so reported as higher — never lowered, never raised.
      expect(rows[1].pricingStatus).toBe("INVOICE_HIGHER");
      expect(cell(3, COLUMN.ek)).toBe(25);
      expect(cell(2, COLUMN.ek)).toBe(55);
    });
  });

  describe("2. a waiting time priced at €0 beside confirmations", () => {
    it("takes the confirmations, summed", async () => {
      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.confirmCost(TRIP, "4139509", "41.25");

      await world.tripService.update(TRIP, BELOW_THRESHOLD);

      expect(world.trips.get(TRIP)!.waitingTimeMinutes).toBe(135);
      expect(storedComponents()).not.toHaveProperty("WAITING_TIME");
      expect(storedComponents()).toMatchObject({ COST_CONFIRMATION: "66.25" });
      expect(await apiPricing()).toMatchObject({ ek: "66.25", totaal: "296.25" });
    });

    it("raises an invoice EK of one confirmation to their sum, the EC lines counted off", async () => {
      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.confirmCost(TRIP, "4139509", "41.25");
      await world.tripService.update(TRIP, BELOW_THRESHOLD);

      const { rows, cell } = await check([transportLine({ ek: null }), costLine(25, "4132482")]);

      expect(rows[1].pricingStatus).toBe("MATCHED_NO_CHANGES");
      // 66.25 owed, 25 of it on the EC line: the transport carries 41.25.
      expect(cell(2, COLUMN.ek)).toBe(41.25);
    });
  });

  it("3. a window with no counted time takes the confirmation", async () => {
    await world.confirmCost(TRIP, "4132482", "25.00");

    await world.tripService.update(TRIP, AT_NIGHT);

    expect(world.trips.get(TRIP)).toMatchObject({ waitingTimeMinutes: 0, waitingTimeEndsNextDay: true });
    expect(storedComponents()).not.toHaveProperty("WAITING_TIME");
    expect(await apiPricing()).toMatchObject({ ek: "25.00", totaal: "255.00" });

    const { rows } = await check([transportLine({ ek: 25 })]);

    expect(rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
  });

  it("4. the same confirmation arriving twice is counted once", async () => {
    await world.confirmCost(TRIP, "4132482", "25.00");

    const repeat = await world.confirmCost(TRIP, "4132482", "25.00");

    expect(repeat.outcome).toBe("ALREADY_RECORDED");
    expect(world.costConfirmations).toHaveLength(1);
    expect(await apiPricing()).toMatchObject({ ek: "25.00", totaal: "255.00" });

    const { rows, cell } = await check([transportLine({ ek: 25, remarks: "tar 869" })]);

    expect(rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
    expect(cell(2, COLUMN.remarks)).toBe("tar 869,EC 4132482");
  });

  it("5. never puts the waiting time in Others", async () => {
    await world.tripService.update(TRIP, CHARGED);

    expect(await apiPricing()).toMatchObject({ others: "0.00", ek: "55.00", totaal: "285.00" });

    const { rows, cell } = await check([transportLine({ ek: 55 })]);

    expect(rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
    expect(cell(2, COLUMN.others)).toBeNull();
  });

  describe("6. the threshold and the blocks of the Waiting Time rule", () => {
    it.each([
      // counted minutes → EK
      ["10:00", "12:29", 149, "0.00"],
      ["10:00", "12:30", 150, "27.50"], // 30 billable → 2 blocks
      ["10:00", "12:31", 151, "41.25"], // 31 billable → 3 blocks
      ["05:00", "08:45", 165, "41.25"], // only 06:00–08:45 counts: 45 → 3 blocks
      ["18:00", "21:00", 120, "0.00"], // only 18:00–20:00 counts
    ])("%s → %s counts %i minutes and charges %s", async (start, end, minutes, ek) => {
      await world.tripService.update(TRIP, { waitingTimeStart: start, waitingTimeEnd: end });

      expect(world.trips.get(TRIP)!.waitingTimeMinutes).toBe(minutes);
      expect(await apiPricing()).toMatchObject({ ek });
    });
  });

  it("7. the invoice check compares with the stored price and keeps the customer's Remarks", async () => {
    await world.confirmCost(TRIP, "4132482", "25.00");
    await world.tripService.update(TRIP, CHARGED);
    const stored = await apiPricing();

    const { rows, cell } = await check([transportLine({ ek: 40, remarks: "tar 869 " })]);

    expect(stored.ek).toBe("55.00");
    expect(rows[0].differences).toEqual(
      expect.arrayContaining([expect.objectContaining({ component: "EK", correctedValue: stored.ek })]),
    );
    expect(cell(2, COLUMN.ek)).toBe(Number(stored.ek));
    // Their words first, unchanged; the confirmation and the window added.
    expect(cell(2, COLUMN.remarks)).toBe("tar 869,EC 4132482,wachtuur 10:00 tot 13:00");
  });

  /**
   * A window ending the next day is a window like any other: written to Remarks
   * in the customer's form, with no note, and priced exactly as before —
   * 18:00 → 20:00 and 06:00 → 08:00 count, 240 minutes → 120 billable → 8 blocks.
   */
  it("9. writes a window ending the next day to Remarks, without a note, its price unchanged", async () => {
    await world.tripService.update(TRIP, { waitingTimeStart: "18:00", waitingTimeEnd: "08:00", waitingTimeEndsNextDay: true });

    expect(world.trips.get(TRIP)).toMatchObject({ waitingTimeMinutes: 240, waitingTimeEndsNextDay: true });
    expect(await apiPricing()).toMatchObject({ ek: "110.00", totaal: "340.00" });

    const { rows, cell } = await check([transportLine({ ek: 110, remarks: "tar 869" })]);

    expect(rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
    expect(cell(2, COLUMN.remarks)).toBe("tar 869,wachtuur 18:00 tot 8:00");
    expect(rows[0].remarks?.notes).toEqual([]);
  });

  describe("8. zero, missing and not applicable stay three things", () => {
    it("no confirmation and no waiting: no EK line at all, and nothing to raise", async () => {
      expect(storedComponents()).not.toHaveProperty("COST_CONFIRMATION");
      expect(storedComponents()).not.toHaveProperty("WAITING_TIME");
      expect(world.trips.get(TRIP)!.waitingTimeMinutes).toBeNull();
      expect(await apiPricing()).toMatchObject({ ek: "0.00" });

      const { rows, cell } = await check([transportLine({ ek: null })]);

      expect(rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
      expect(cell(2, COLUMN.ek)).toBeNull();
    });

    it("equal times are a stored zero, not a missing window, and still yield to the confirmation", async () => {
      await world.confirmCost(TRIP, "4132482", "25.00");

      await world.tripService.update(TRIP, { waitingTimeStart: "10:00", waitingTimeEnd: "10:00" });

      expect(world.trips.get(TRIP)!.waitingTimeMinutes).toBe(0);
      expect(await apiPricing()).toMatchObject({ ek: "25.00" });
    });

    it("a removed window is missing again, and the confirmation is the EK", async () => {
      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.tripService.update(TRIP, CHARGED);

      await world.tripService.update(TRIP, { waitingTimeStart: null, waitingTimeEnd: null });

      expect(world.trips.get(TRIP)!.waitingTimeMinutes).toBeNull();
      expect(storedComponents()).toMatchObject({ COST_CONFIRMATION: "25.00" });
      expect(await apiPricing()).toMatchObject({ ek: "25.00" });
    });
  });
});
