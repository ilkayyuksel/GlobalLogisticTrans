import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  buildInvoiceAuditService,
  buildInvoicePaymentService,
  paymentRepository,
} from "./__fixtures__/invoice-audit-service";
import { reliablyPriced } from "./__fixtures__/invoice-pricing";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import { InvoiceWorkbookIntegrityException } from "./exceptions/invoice-audit.exceptions";
import { InvoiceSheetWriter } from "./workbook/invoice-sheet.writer";

/**
 * I2 — a corrected file that is not exactly the received one plus the plan
 * never leaves this system: no file, no success, and no payment on it.
 *
 * The writer is the real one, made to misbehave after it has done its work.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));
const TRIP = "3f1b0d2e-0000-4000-8000-000000000001";

describe("a corrected invoice that does not match its plan", () => {
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;
  let writer: InvoiceSheetWriter;
  let doubles: Parameters<typeof buildInvoiceAuditService>[0];

  beforeEach(() => {
    jest.clearAllMocks();
    writer = new InvoiceSheetWriter(logger);
    doubles = {
      logger,
      writer,
      trips: {
        findManyForInvoice: jest.fn().mockResolvedValue([
          { id: TRIP, status: TripStatus.CLOSED, isPaid: false, planningDate: MONDAY, bookingNumber: "DUBANR2718284", containerNumber: "EUCU4581604" },
        ]),
        findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      },
      effectivePricing: {
        findForTrips: jest.fn().mockResolvedValue(
          new Map([
            [
              TRIP,
              reliablyPriced({
                components: [],
                tarief: new Prisma.Decimal("425"),
                brandstof: new Prisma.Decimal("42.50"),
                backload: new Prisma.Decimal("0"),
                tol: new Prisma.Decimal("0"),
                tunnel: new Prisma.Decimal("0"),
                others: new Prisma.Decimal("0"),
                ek: new Prisma.Decimal("0"),
                totaal: new Prisma.Decimal("467.50"),
              }),
            ],
          ]),
        ),
      },
    };
  });

  async function invoice() {
    const file = await buildInvoiceWorkbook({
      lines: [{ planningDate: MONDAY, bookingNumber: "DUBANR2718284", containerNumber: "EUCU 4581604", tarief: 370, fuel: 37 }],
    });

    return { buffer: file, originalname: "week 13 - 2026 GLT.xlsx", size: file.length };
  }

  /** The real writer, and then one cell nobody planned. */
  function writerThatAlsoWrites(address: string, value: string | null): void {
    const apply = writer.apply.bind(writer);

    jest.spyOn(writer, "apply").mockImplementation((workbook, worksheet, ...rest) => {
      const outcome = apply(workbook, worksheet, ...rest);

      worksheet.getCell(address).value = value;

      return outcome;
    });
  }

  it("is verified and answered when the writer does exactly the plan", async () => {
    const applied = await buildInvoiceAuditService(doubles).apply(await invoice());

    expect(applied.workbook.length).toBeGreaterThan(0);
    expect(logger.log).toHaveBeenCalledWith(
      "Corrected invoice verified against its plan",
      expect.objectContaining({ plannedCells: 2 }),
    );
  });

  it("answers no file when the writer changed a cell nobody planned", async () => {
    writerThatAlsoWrites("H2", "tampered");

    await expect(buildInvoiceAuditService(doubles).apply(await invoice())).rejects.toMatchObject({
      constructor: InvoiceWorkbookIntegrityException,
      response: { details: ["H2: waarde gewijzigd zonder plan."] },
    });
    expect(logger.error).toHaveBeenCalledWith(
      "Corrected invoice failed its integrity check",
      expect.objectContaining({ problems: ["H2: waarde gewijzigd zonder plan."] }),
    );
    expect(logger.log).not.toHaveBeenCalledWith("Corrected invoice produced", expect.anything());
  });

  it("answers no file when the writer left out a planned change", async () => {
    // The raised Tarief, put back to what the customer stated.
    writerThatAlsoWrites("L2", null);

    await expect(buildInvoiceAuditService(doubles).apply(await invoice())).rejects.toBeInstanceOf(
      InvoiceWorkbookIntegrityException,
    );
  });

  it("pays nothing on an invoice whose corrected file was refused", async () => {
    const payments = paymentRepository();

    writerThatAlsoWrites("H2", "tampered");

    await expect(
      buildInvoicePaymentService(doubles, payments).confirm(await invoice(), [TRIP]),
    ).rejects.toBeInstanceOf(InvoiceWorkbookIntegrityException);
    expect(payments.settle).not.toHaveBeenCalled();
  });
});
