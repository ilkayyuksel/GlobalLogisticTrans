import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import {
  EmailProcessingStatus,
  ImportType,
  ImportedEmail,
} from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { ImportedEmailController } from "./imported-email.controller";
import { ImportedEmailRepository } from "./imported-email.repository";
import { ImportedEmailService } from "./imported-email.service";

/**
 * The import-monitoring endpoint.
 *
 * Real routing, the global ValidationPipe, the interceptor and the filter all
 * run; only the repository is stubbed. The assertions that matter most are
 * about what is NOT returned: the body and the message id must never reach a
 * client.
 */

const BASE = "/api/v1/imported-emails";
const PDF_ID = "d2222222-2222-4222-8222-222222222222";

function buildEmail(overrides: Partial<ImportedEmail> = {}) {
  return {
    id: "e1111111-1111-4111-8111-111111111111",
    senderEmail: "orders@carrier.test",
    subject: "NEW: Trucking Order 1212816",
    messageId: "<order-1@carrier.test>",
    receivedAt: new Date("2026-08-13T06:00:00.000Z"),
    processedAt: new Date("2026-08-13T06:00:05.000Z"),
    processingStatus: EmailProcessingStatus.PROCESSED,
    importType: ImportType.NEW,
    body: "Please find the transport order attached. Regards, Dispatch.",
    createdAt: new Date("2026-08-13T06:00:00.000Z"),
    updatedAt: new Date("2026-08-13T06:00:05.000Z"),
    pdfDocument: { id: PDF_ID },
    ...overrides,
  };
}

describe("ImportedEmailController (integration)", () => {
  let app: INestApplication;
  let repository: { findPage: jest.Mock };

  beforeEach(async () => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ImportedEmailController],
      providers: [
        ImportedEmailService,
        { provide: ImportedEmailRepository, useValue: repository },
        {
          provide: AppLoggerService,
          useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() },
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("listing", () => {
    it("returns an empty page in the standard envelope", async () => {
      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        items: [],
        meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
      });
    });

    it("returns the fields an operator needs", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildEmail()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.data.items[0]).toEqual({
        id: "e1111111-1111-4111-8111-111111111111",
        senderEmail: "orders@carrier.test",
        subject: "NEW: Trucking Order 1212816",
        receivedAt: "2026-08-13T06:00:00.000Z",
        processedAt: "2026-08-13T06:00:05.000Z",
        processingStatus: "PROCESSED",
        importType: "NEW",
        pdfDocumentId: PDF_ID,
      });
    });

    /**
     * The body is stored only for diagnosing a failure and may carry customer
     * correspondence. It must not travel to a browser.
     */
    it("never exposes the message body or the message id", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildEmail()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);
      const serialised = JSON.stringify(response.body);

      expect(serialised).not.toContain("Regards, Dispatch");
      expect(serialised).not.toContain("body");
      expect(serialised).not.toContain("messageId");
    });

    it("reports a null pdf document for an email that produced none", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildEmail({ processingStatus: EmailProcessingStatus.FAILED })],
        totalItems: 1,
      });
      repository.findPage.mockResolvedValue({
        items: [{ ...buildEmail(), pdfDocument: null }],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.data.items[0].pdfDocumentId).toBeNull();
    });

    it("asks the repository for the newest page first", async () => {
      await request(app.getHttpServer()).get(BASE).expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 }),
      );
    });
  });

  describe("statuses and types", () => {
    it.each([
      EmailProcessingStatus.RECEIVED,
      EmailProcessingStatus.PROCESSING,
      EmailProcessingStatus.PROCESSED,
      EmailProcessingStatus.FAILED,
      EmailProcessingStatus.IGNORED,
    ])("returns %s unchanged", async (processingStatus) => {
      repository.findPage.mockResolvedValue({
        items: [buildEmail({ processingStatus })],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.data.items[0].processingStatus).toBe(processingStatus);
    });

    it.each([ImportType.NEW, ImportType.UPDATE, ImportType.CANCEL])(
      "returns import type %s unchanged",
      async (importType) => {
        repository.findPage.mockResolvedValue({
          items: [buildEmail({ importType })],
          totalItems: 1,
        });

        const response = await request(app.getHttpServer()).get(BASE).expect(200);

        expect(response.body.data.items[0].importType).toBe(importType);
      },
    );

    /** A failure has no completion time, because nothing completed. */
    it("returns a null processedAt for a failed email", async () => {
      repository.findPage.mockResolvedValue({
        items: [
          buildEmail({
            processingStatus: EmailProcessingStatus.FAILED,
            processedAt: null,
          }),
        ],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.data.items[0].processedAt).toBeNull();
    });
  });

  describe("filtering", () => {
    it("passes a status filter through", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?processingStatus=FAILED`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          processingStatus: EmailProcessingStatus.FAILED,
        }),
      );
    });

    it("passes an import type filter through", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?importType=CANCEL`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ importType: ImportType.CANCEL }),
      );
    });

    it.each([
      ["processingStatus=NOPE", "an unknown status"],
      ["importType=NOPE", "an unknown import type"],
      ["page=0", "a page below one"],
      ["pageSize=201", "a page size above the cap"],
      ["senderEmail=a@b.test", "an unsupported filter"],
    ])("rejects %s (%s)", async (query) => {
      await request(app.getHttpServer()).get(`${BASE}?${query}`).expect(400);
    });
  });

  describe("pagination", () => {
    it("honours page and pageSize", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?page=3&pageSize=10`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it("reports the backend's totals", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildEmail()],
        totalItems: 42,
      });

      const response = await request(app.getHttpServer())
        .get(`${BASE}?pageSize=10`)
        .expect(200);

      expect(response.body.data.meta).toEqual({
        page: 1,
        pageSize: 10,
        totalItems: 42,
        totalPages: 5,
      });
    });
  });

  /** The record of what happened must not be editable from outside. */
  describe("what is deliberately absent", () => {
    it.each([
      ["post", BASE],
      ["patch", `${BASE}/e1111111-1111-4111-8111-111111111111`],
      ["delete", `${BASE}/e1111111-1111-4111-8111-111111111111`],
    ])("does not route %s %s", async (method, path) => {
      const server = request(app.getHttpServer());

      await (method === "post"
        ? server.post(path)
        : method === "patch"
          ? server.patch(path)
          : server.delete(path)
      ).expect(404);
    });
  });
});
