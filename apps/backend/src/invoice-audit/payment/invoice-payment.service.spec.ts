import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../../logger/app-logger.service";
import { type CurrentTripPricing } from "../../trip-pricing/effective-pricing.service";
import {
  buildInvoicePaymentService,
  paymentRepository,
} from "../__fixtures__/invoice-audit-service";
import { reliablyPriced } from "../__fixtures__/invoice-pricing";
import { invoiceReads } from "../__fixtures__/invoice-reads";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "../__fixtures__/invoice-workbook";
import { PaymentSelectionNoLongerEligibleException } from "../exceptions/invoice-audit.exceptions";
import { InvoicePaymentService } from "./invoice-payment.service";

/**
 * The separate payment confirmation: the original document again, with the
 * Trips an operator chose. The document is examined afresh; only what is
 * payable on it NOW is paid, and a single choice that is not refuses all.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));
const ONE = "11111111-0000-4000-8000-000000000001";
const TWO = "22222222-0000-4000-8000-000000000002";

function pricing(tarief: string, brandstof: string, ek = "0"): CurrentTripPricing {
  const zero = new Prisma.Decimal(0);

  return reliablyPriced({
    components: [],
    tarief: new Prisma.Decimal(tarief),
    brandstof: new Prisma.Decimal(brandstof),
    backload: zero,
    tol: zero,
    tunnel: zero,
    others: zero,
    ek: new Prisma.Decimal(ek),
    totaal: new Prisma.Decimal(tarief).add(brandstof).add(ek),
  });
}

function trip(id: string, bookingNumber: string, containerNumber: string, overrides = {}) {
  return {
    id,
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: MONDAY,
    originalPlanningDate: MONDAY,
    bookingNumber,
    containerNumber,
    tripGroupId: null,
    direction: "DELIVERY",
    terminal: "Quay 869",
    destinationCity: "ZEMST",
    ...overrides,
  };
}

function line(bookingNumber: string, containerNumber: string, amounts: Partial<InvoiceFixtureLine> = {}) {
  return { planningDate: MONDAY, bookingNumber, containerNumber, tarief: 370, fuel: 37, ...amounts };
}

describe("InvoicePaymentService", () => {
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;
  let trips: { findManyForInvoice: jest.Mock; findClosedUnpaidBetween: jest.Mock };
  let effectivePricing: { findForTrips: jest.Mock };
  let reads: ReturnType<typeof invoiceReads>;
  let payments: ReturnType<typeof paymentRepository>;
  let service: InvoicePaymentService;

  beforeEach(() => {
    trips = {
      findManyForInvoice: jest.fn().mockResolvedValue([
        trip(ONE, "DUBANR2718284", "EUCU4581604"),
        trip(TWO, "BELANR2720016", "EUCU2451828"),
      ]),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
    };
    effectivePricing = {
      findForTrips: jest.fn().mockResolvedValue(
        new Map([
          [ONE, pricing("370", "37")],
          [TWO, pricing("425", "42.50")],
        ]),
      ),
    };
    reads = invoiceReads();
    payments = paymentRepository();
    service = buildInvoicePaymentService({ trips, effectivePricing, logger, reads }, payments);
  });

  async function confirm(tripIds: string[], lines = [line("DUBANR2718284", "EUCU 4581604"), line("BELANR2720016", "EUCU 2451828")]) {
    const file = await buildInvoiceWorkbook({ lines });

    return service.confirm(
      { buffer: file, originalname: "week 13 - 2026 GLT.xlsx", size: file.length },
      tripIds,
    );
  }

  /** B2 — the chosen payable transports, one with a raised price, in one call. */
  it("pays exactly the chosen transports, raised prices included", async () => {
    const result = await confirm([ONE, TWO]);

    expect(payments.settle).toHaveBeenCalledTimes(1);
    expect(payments.settle).toHaveBeenCalledWith([ONE, TWO]);
    expect(result).toEqual({ paidTrips: 2, alreadyPaid: 0, paidTripIds: [ONE, TWO] });
  });

  it("pays only what was chosen, not everything payable", async () => {
    await confirm([TWO]);

    expect(payments.settle).toHaveBeenCalledWith([TWO]);
  });

  /** B3 — one choice no longer payable refuses the whole request. */
  it("refuses everything when one chosen transport is no longer payable", async () => {
    trips.findManyForInvoice.mockResolvedValue([
      trip(ONE, "DUBANR2718284", "EUCU4581604"),
      trip(TWO, "BELANR2720016", "EUCU2451828", { status: TripStatus.OPEN }),
    ]);

    await expect(confirm([ONE, TWO])).rejects.toBeInstanceOf(
      PaymentSelectionNoLongerEligibleException,
    );
    expect(payments.settle).not.toHaveBeenCalled();
  });

  it("refuses a Trip the invoice does not charge at all", async () => {
    const refusal = confirm([ONE, "99999999-0000-4000-8000-000000000009"]);

    await expect(refusal).rejects.toMatchObject({
      response: { details: ["99999999-0000-4000-8000-000000000009: NOT_ON_INVOICE"] },
    });
    expect(payments.settle).not.toHaveBeenCalled();
  });

  /** B4 — a failing write pays nothing and reports no success. */
  it("reports the failure when the write fails", async () => {
    payments.settle.mockRejectedValue(new Error("the database is gone"));

    await expect(confirm([ONE])).rejects.toThrow("the database is gone");
  });

  /** B5 — confirming again changes nothing. */
  it("leaves a chosen transport that is already paid as it is", async () => {
    trips.findManyForInvoice.mockResolvedValue([
      trip(ONE, "DUBANR2718284", "EUCU4581604", { isPaid: true }),
      trip(TWO, "BELANR2720016", "EUCU2451828", { isPaid: true }),
    ]);

    const result = await confirm([ONE, TWO]);

    expect(payments.settle).toHaveBeenCalledWith([]);
    expect(result).toEqual({ paidTrips: 0, alreadyPaid: 2, paidTripIds: [] });
  });

  /** B6 — what is never a ground for payment. */
  describe("what it never pays", () => {
    it("a transport whose price cannot be relied on", async () => {
      effectivePricing.findForTrips.mockResolvedValue(new Map([[ONE, pricing("370", "37")]]));

      await expect(confirm([TWO])).rejects.toMatchObject({
        response: { details: [expect.stringContaining("PRICE_NOT_SETTLED")] },
      });
    });

    it("a transport whose line is marked yellow", async () => {
      // A difference two lines share cannot be placed: the line is reviewed.
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([[ONE, pricing("370", "37", "250")]]),
      );

      await expect(
        confirm(
          [ONE],
          [
            line("DUBANR2718284", "EUCU 4581604", { ek: 120 }),
            line("DUBANR2718284", "EUCU 4581604", { tarief: null, fuel: null, ek: 80 }),
          ],
        ),
      ).rejects.toMatchObject({
        response: { details: [expect.stringContaining("LINE_MARKED")] },
      });
    });

    it("a transport only Cost Confirmation lines charge", async () => {
      reads.findCostConfirmationsByNumbers.mockResolvedValue([
        { tripId: ONE, ccNumber: "4220981", amount: new Prisma.Decimal(110) },
      ]);
      reads.findTripsByIds.mockResolvedValue([
        trip(ONE, "DUBANR2718284", "EUCU4581604") as never,
      ]);
      trips.findManyForInvoice.mockResolvedValue([]);

      await expect(
        confirm(
          [ONE],
          [
            line("DUBANR2718284", "", {
              tarief: null,
              fuel: null,
              ek: 110,
              remarks: "EC 4220981",
              containerType: null,
              startPoint: null,
              endPoint: null,
            }),
          ],
        ),
      ).rejects.toMatchObject({
        response: { details: [expect.stringContaining("NO_OWN_LINE")] },
      });
    });
  });

  /** B7 — a higher invoice price is payable: everything owed is on it. */
  it("pays a transport the invoice charges more for than this system holds", async () => {
    effectivePricing.findForTrips.mockResolvedValue(new Map([[ONE, pricing("300", "30")]]));

    await confirm([ONE]);

    expect(payments.settle).toHaveBeenCalledWith([ONE]);
  });
});
