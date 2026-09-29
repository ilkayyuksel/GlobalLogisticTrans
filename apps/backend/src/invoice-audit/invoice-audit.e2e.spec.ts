import { Global, INestApplication, Module, VersioningType } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import ExcelJS from "exceljs";
import { Prisma, TripStatus } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { TripRepository } from "../trips/trip.repository";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import { InvoiceAuditModule } from "./invoice-audit.module";

/**
 * A weekly invoice, uploaded over HTTP.
 *
 * Everything between the request and the answer is genuine: multipart handling,
 * the size limit, the content check, the workbook reader, the matching rule and
 * the response envelope. Only the two edges are replaced — the database,
 * because a test must not read the seeded one, and the logger, because a test
 * must not print.
 *
 *   HTTP multipart → InvoiceAuditService → InvoiceSheetReader → matching
 */

const CHECK_PATH = "/api/v1/invoice-audit/check";
const APPLY_PATH = "/api/v1/invoice-audit/apply";
const MAX_UPLOAD_MEGABYTES = 1;
const MONDAY = new Date(Date.UTC(2026, 2, 23));

/**
 * The customer's real weekly invoice, when the person running the tests has a
 * copy of it.
 *
 * ── WHY IT IS OPTIONAL ──────────────────────────────────────────────────────
 * These are the customer's commercial figures and they are deliberately NOT in
 * the repository. The structural tests all run against the synthetic fixture,
 * which reproduces the same shape; this one adds a regression against the real
 * document for whoever has it, and is skipped where it is absent so the suite
 * stays green on every checkout.
 */
const REAL_INVOICE = resolve(
  __dirname,
  "../../../../docs/07-excels/week 13 - 2026 GLT.xlsx",
);

describe("Weekly invoice check, end to end over HTTP", () => {
  let application: INestApplication;
  let findManyForInvoice: jest.Mock;
  let findClosedUnpaidBetween: jest.Mock;
  let findForTrips: jest.Mock;
  let setPaidMany: jest.Mock;

  beforeEach(async () => {
    findManyForInvoice = jest.fn().mockResolvedValue([]);
    // Nothing is missing from the invoice unless a test says so.
    findClosedUnpaidBetween = jest.fn().mockResolvedValue([]);
    setPaidMany = jest.fn(async (ids: readonly string[]) => ids.length);
    // The pricing READ, doubled: this suite is about the HTTP path, and the
    // comparison itself has its own tests.
    findForTrips = jest.fn().mockResolvedValue(new Map());

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    /** The infrastructure the module expects to find already present. */
    @Global()
    @Module({
      providers: [
        { provide: AppLoggerService, useValue: logger },
        // Never queried: the one repository that would use it is replaced.
        { provide: PrismaService, useValue: {} },
      ],
      exports: [AppLoggerService, PrismaService],
    })
    class TestInfrastructureModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ INVOICE_UPLOAD_MAX_SIZE_MB: MAX_UPLOAD_MEGABYTES })],
        }),
        TestInfrastructureModule,
        InvoiceAuditModule,
      ],
    })
      .overrideProvider(TripRepository)
      .useValue({
        findManyForInvoice,
        findClosedUnpaidBetween,
        setPaidMany,
      } as unknown as TripRepository)
      .overrideProvider(EffectivePricingService)
      .useValue({ findForTrips } as unknown as EffectivePricingService)
      .compile();

    application = moduleRef.createNestApplication();

    // The same routing and the same envelope as the running backend, so the
    // path and the response shape asserted here are the real ones.
    application.setGlobalPrefix("api");
    application.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: "1",
    });
    application.useGlobalInterceptors(new ResponseInterceptor());
    application.useGlobalFilters(new AllExceptionsFilter(logger));

    await application.init();
  });

  afterEach(async () => {
    await application.close();
  });

  function check() {
    return request(application.getHttpServer()).post(CHECK_PATH);
  }

  function apply() {
    return request(application.getHttpServer()).post(APPLY_PATH);
  }

  describe("a valid invoice", () => {
    it("answers with the lines and their statuses", async () => {
      findManyForInvoice.mockResolvedValue([
        {
          id: "3f1b0d2e-0000-4000-8000-000000000001",
          status: TripStatus.CLOSED,
          planningDate: MONDAY,
          bookingNumber: "DUBANR2718284",
          containerNumber: "EUCU4581604",
        },
      ]);

      const file = await buildInvoiceWorkbook({
        lines: [
          {
            planningDate: MONDAY,
            bookingNumber: "DUBANR2718284",
            containerNumber: "EUCU 4581604",
            tarief: 135,
          },
          {
            planningDate: MONDAY,
            bookingNumber: "ANRDUB2725107",
            containerNumber: "TLLU 1595717",
            tarief: 149,
          },
        ],
      });

      const response = await check()
        .attach("file", file, "week 13 - 2026 GLT.xlsx")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        fileName: "week 13 - 2026 GLT.xlsx",
        period: { from: "2026-03-23", to: "2026-03-23" },
        summary: { totalRows: 2, matched: 1, notFound: 1 },
      });
      expect(response.body.data.rows[0]).toMatchObject({
        rowNumber: 2,
        status: "MATCHED",
        trip: { id: "3f1b0d2e-0000-4000-8000-000000000001", status: "CLOSED" },
      });
    });

    /** One query for the whole document, over the real HTTP path too. */
    it("asks the database once", async () => {
      const file = await buildInvoiceWorkbook({
        lines: Array.from({ length: 40 }, (_value, index) => ({
          planningDate: MONDAY,
          bookingNumber: `ANRDUB${2725000 + index}`,
          containerNumber: `EUCU ${4581000 + index}`,
          tarief: 100,
        })),
      });

      await check().attach("file", file, "week 13.xlsx").expect(200);

      expect(findManyForInvoice).toHaveBeenCalledTimes(1);
    });
  });

  describe("what is refused", () => {
    it("refuses a request with no file", async () => {
      const response = await check().expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(/no file was uploaded/);
    });

    it("refuses a file that is not an .xlsx", async () => {
      const response = await check()
        .attach("file", Buffer.from("%PDF-1.7"), "order.pdf")
        .expect(400);

      expect(response.body.error.message).toMatch(/only \.xlsx/);
    });

    it("refuses a renamed file whose bytes are not a workbook", async () => {
      const response = await check()
        .attach("file", Buffer.from("%PDF-1.7 pretending"), "week 13.xlsx")
        .expect(400);

      expect(response.body.error.message).toMatch(/not an Excel workbook/);
    });

    it("names the columns a malformed workbook is missing", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [],
        headers: ["Planning date", "Bookingnr", "Container nr."],
      });

      const response = await check()
        .attach("file", file, "week 13.xlsx")
        .expect(400);

      expect(response.body.error.details).toContain("missing column: Tarief");
    });
  });

  /**
   * ── THE FINAL PROCESSING, OVER HTTP ─────────────────────────────────────
   * The file comes back as bytes with the name an operator will save it under,
   * and what the run did travels in headers beside it. Nothing about the flow
   * is doubled but the database.
   */
  describe("processing a weekly invoice", () => {
    async function aWeek() {
      findManyForInvoice.mockResolvedValue([
        {
          id: "3f1b0d2e-0000-4000-8000-000000000001",
          status: TripStatus.CLOSED,
          isPaid: false,
          planningDate: MONDAY,
          bookingNumber: "DUBANR2718284",
          containerNumber: "EUCU4581604",
        },
      ]);
      findForTrips.mockResolvedValue(
        new Map([
          [
            "3f1b0d2e-0000-4000-8000-000000000001",
            {
              components: [],
              tarief: new Prisma.Decimal("425"),
              brandstof: new Prisma.Decimal("42.50"),
              backload: new Prisma.Decimal("0"),
              tol: new Prisma.Decimal("0"),
              tunnel: new Prisma.Decimal("0"),
              others: new Prisma.Decimal("0"),
              ek: new Prisma.Decimal("0"),
              totaal: new Prisma.Decimal("467.50"),
            },
          ],
        ]),
      );

      return buildInvoiceWorkbook({
        lines: [
          {
            planningDate: MONDAY,
            bookingNumber: "DUBANR2718284",
            containerNumber: "EUCU 4581604",
            tarief: 370,
            fuel: 37,
          },
        ],
      });
    }

    it("answers with a workbook the browser can save", async () => {
      const response = await apply()
        .attach("file", await aWeek(), "week 13 - 2026 GLT.xlsx")
        .expect(200);

      expect(response.headers["content-type"]).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(response.headers["content-disposition"]).toBe(
        'attachment; filename="week 13 - 2026 GLT - gecorrigeerd.xlsx"',
      );
      expect(response.headers["access-control-expose-headers"]).toContain(
        "content-disposition",
      );
    });

    it("says what it did in the headers beside the file", async () => {
      const response = await apply()
        .attach("file", await aWeek(), "week 13 - 2026 GLT.xlsx")
        .expect(200);

      expect(response.headers["x-invoice-paid-trips"]).toBe("1");
      expect(response.headers["x-invoice-already-paid"]).toBe("0");
      expect(response.headers["x-invoice-cells-corrected"]).toBe("2");
      expect(response.headers["x-invoice-rows-added"]).toBe("0");
    });

    it("settles the transport the invoice covers", async () => {
      await apply()
        .attach("file", await aWeek(), "week 13 - 2026 GLT.xlsx")
        .expect(200);

      expect(setPaidMany).toHaveBeenCalledWith([
        "3f1b0d2e-0000-4000-8000-000000000001",
      ]);
    });

    it("returns a workbook that reads back, corrected", async () => {
      const response = await apply()
        .attach("file", await aWeek(), "week 13 - 2026 GLT.xlsx")
        .buffer()
        .parse((res, callback) => {
          const chunks: Buffer[] = [];

          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];

      expect(sheet.getRow(1).getCell(1).value).toBe("Planning date");
      expect(sheet.getRow(2).getCell(12).value).toBe(425);
    });

    it("refuses what the check refuses, and settles nothing", async () => {
      const response = await apply()
        .attach("file", Buffer.from("%PDF-1.7 pretending"), "week 13.xlsx")
        .expect(400);

      expect(response.body.error.message).toMatch(/not an Excel workbook/);
      expect(setPaidMany).not.toHaveBeenCalled();
    });
  });

  describe("against the real document", () => {
    const itWithRealFile = existsSync(REAL_INVOICE) ? it : it.skip;

    /**
     * The structure of an actual customer invoice: 21 columns, a header row,
     * its transports, a totals row and a summary block. Nothing about the
     * amounts is asserted — only that the document is read as the lines it
     * states and nothing else.
     */
    itWithRealFile("reads every line and no totals row", async () => {
      const response = await check()
        .attach("file", readFileSync(REAL_INVOICE), "week 13 - 2026 GLT.xlsx")
        .expect(200);

      const { data } = response.body;

      expect(data.summary.totalRows).toBe(98);
      expect(data.period).toEqual({ from: "2026-03-23", to: "2026-03-27" });
      // Every line states all three values, so none was reported incomplete.
      expect(data.incompleteRowNumbers).toEqual([]);
      // The transports start on row 2 and the last one is row 99: the totals
      // row and the summary block below it are not lines.
      expect(data.rows[0].rowNumber).toBe(2);
      expect(data.rows[data.rows.length - 1].rowNumber).toBe(99);
      // Containers are printed with a space and compared without one.
      expect(data.rows[0].containerNumber).toMatch(/\s/);
      expect(data.rows[0].normalizedContainerNumber).not.toMatch(/\s/);
    });
  });
});
