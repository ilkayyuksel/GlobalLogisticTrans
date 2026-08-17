import {
  Global,
  INestApplication,
  Module,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { PdfDocumentModule } from "./pdf-document.module";
import { PdfDocumentRepository } from "./pdf-document.repository";

/**
 * Serving a stored transport order over HTTP.
 *
 * The real controller, the real service, the real filesystem — only the
 * database and the logger are doubles. What matters here is that the bytes come
 * back intact and that nothing about where they live comes back at all.
 */

const DOCUMENT_ID = "d2222222-2222-4222-8222-222222222222";
const STORAGE_PATH = "d0598b5978a891ec6257da0bb25d808818fe8e1f.pdf";
const PDF_BYTES = Buffer.from("%PDF-1.7\nstored transport order\n%%EOF\n");
const CONTENT_PATH = `/api/v1/pdf-documents/${DOCUMENT_ID}/content`;

describe("Reading a stored PDF over HTTP", () => {
  let application: INestApplication;
  let storageDirectory: string;
  let document: Record<string, unknown> | null;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-pdf-content-"));

    document = {
      id: DOCUMENT_ID,
      storagePath: STORAGE_PATH,
      originalFilename: "transport order.pdf",
      fileHash: "d0598b5978a891ec6257da0bb25d808818fe8e1f",
      mimeType: "application/pdf",
    };

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    @Global()
    @Module({
      providers: [
        { provide: AppLoggerService, useValue: logger },
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
          load: [() => ({ PDF_STORAGE_DIR: storageDirectory })],
        }),
        TestInfrastructureModule,
        PdfDocumentModule,
      ],
    })
      .overrideProvider(PdfDocumentRepository)
      .useValue({
        findById: jest.fn(() => Promise.resolve(document)),
        findByFileHash: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      })
      .compile();

    application = moduleRef.createNestApplication();
    application.setGlobalPrefix("api");
    application.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: "1",
    });
    // The same pipe main.ts installs, so a malformed id is refused here for the
    // same reason it is refused in the running application.
    application.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    application.useGlobalInterceptors(new ResponseInterceptor());
    application.useGlobalFilters(new AllExceptionsFilter(logger));

    await application.init();
    await writeFile(join(storageDirectory, STORAGE_PATH), PDF_BYTES);
  });

  afterEach(async () => {
    await application.close();
    await rm(storageDirectory, { recursive: true, force: true });
  });

  function get(path = CONTENT_PATH) {
    return request(application.getHttpServer()).get(path);
  }

  describe("an existing document", () => {
    it("returns the stored bytes as a PDF", async () => {
      const response = await get().expect(200);

      expect(response.headers["content-type"]).toContain("application/pdf");
      expect(Buffer.from(response.body).equals(PDF_BYTES)).toBe(true);
    });

    /** A viewer needs it inline; that is the default. */
    it("offers it for display by default", async () => {
      const response = await get().expect(200);

      expect(response.headers["content-disposition"]).toContain("inline");
    });

    it("offers it as a download when asked", async () => {
      const response = await get(`${CONTENT_PATH}?download=true`).expect(200);

      expect(response.headers["content-disposition"]).toContain("attachment");
    });

    /**
     * The name the document arrived under, not the content hash it is stored
     * as — and stripped of anything that could write a second header field.
     */
    it("names the file as it arrived, safely", async () => {
      const response = await get().expect(200);

      expect(response.headers["content-disposition"]).toContain(
        'filename="transport_order.pdf"',
      );
    });

    /** A PDF wrapped in the JSON envelope would no longer be a PDF. */
    it("is not wrapped in the response envelope", async () => {
      const response = await get().expect(200);

      expect(response.text ?? "").not.toContain('"success"');
      expect(Buffer.from(response.body).subarray(0, 5).toString()).toBe("%PDF-");
    });

    /** Nothing about where the file lives may reach a client. */
    it("never reveals the storage path", async () => {
      const response = await get().expect(200);

      const everything = JSON.stringify(response.headers) + response.text;

      expect(everything).not.toContain(STORAGE_PATH);
      expect(everything).not.toContain(storageDirectory);
    });
  });

  describe("when it cannot be served", () => {
    it("reports an unknown document as 404", async () => {
      document = null;

      const response = await get().expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("does not exist");
    });

    /**
     * The row is there and the file is not: a storage problem, not a wrong id,
     * so it is reported as Gone rather than Not Found.
     */
    it("reports a missing stored file as 410", async () => {
      await rm(join(storageDirectory, STORAGE_PATH));

      const response = await get().expect(410);

      expect(response.body.error.message).toContain("no longer in storage");
      expect(JSON.stringify(response.body)).not.toContain(STORAGE_PATH);
    });

    it("refuses a malformed id", async () => {
      await get("/api/v1/pdf-documents/not-a-uuid/content").expect(400);
    });

    /** An unexpected filesystem failure must not leak internals. */
    it("keeps an unexpected failure generic", async () => {
      document = { ...document, storagePath: 42 };

      const response = await get().expect(500);

      expect(response.body.error.message).toBe("Internal server error");
    });
  });
});
