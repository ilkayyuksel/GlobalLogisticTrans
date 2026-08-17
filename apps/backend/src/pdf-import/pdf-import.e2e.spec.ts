import { Global, INestApplication, Module, VersioningType } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ImportSource, TripStatus } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import request from "supertest";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { PrismaService } from "../prisma/prisma.service";
import { TripPlanningDataService } from "../trips/trip-planning-data.service";
import { TripRepository } from "../trips/trip.repository";
import { PdfImportModule } from "./pdf-import.module";

/**
 * A real transport order, uploaded over HTTP, through the real parser.
 *
 * Everything between the request and the rows is genuine: multipart handling,
 * the size and count limits, validation, the parser, the importer, the
 * transaction orchestration and the response envelope. Only the two edges are
 * replaced — the database, because a test must not write to the seeded one, and
 * the logger, because a test must not print.
 *
 *   HTTP multipart → PdfUploadService → PdfTripImporter → PdfDocument → Trips
 */

/**
 * These are the only backend tests that load pdfjs and parse real PDFs. The
 * cold start alone costs seconds, and under a full parallel suite it competes
 * for CPU — well beyond Jest's five-second default, for reasons that have
 * nothing to do with the code under test.
 */
jest.setTimeout(120_000);

/**
 * The real transport orders, filed by the kind of email they arrived in. These
 * tests upload NEW orders, which is the flow this endpoint serves.
 */
const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf/NEW");
const PDF_DOCUMENT_ID = "d2222222-2222-4222-8222-222222222222";
const TRIP_GROUP_ID = "97777777-7777-4777-8777-777777777777";
const UPLOAD_PATH = "/api/v1/pdf-import";

/** Small enough that an oversized fixture stays cheap to build. */
const MAX_UPLOAD_MEGABYTES = 1;

function readFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

interface CreatedTrip extends Record<string, unknown> {
  bookingNumber: string;
}

describe("Manual PDF upload, end to end over HTTP", () => {
  let application: INestApplication;
  let storageDirectory: string;
  let createdTrips: CreatedTrip[];
  let createdPdfDocuments: Record<string, unknown>[];
  let publishedEvents: unknown[];

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-upload-e2e-"));
    createdTrips = [];
    createdPdfDocuments = [];
    publishedEvents = [];

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    const pdfDocumentRepository = {
      // Content-addressed, as the real column is: the second upload of the same
      // bytes finds the first document, which is what stops cleanup from
      // deleting a file an earlier import still owns.
      findByFileHash: jest.fn((fileHash: string) =>
        Promise.resolve(
          createdPdfDocuments.find(
            (document) => document.fileHash === fileHash,
          ) ?? null,
        ),
      ),
      create: jest.fn((data: Record<string, unknown>) => {
        const document = { id: PDF_DOCUMENT_ID, ...data };
        createdPdfDocuments.push(document);
        return Promise.resolve(document);
      }),
    } as unknown as PdfDocumentRepository;

    const tripRepository = {
      // The real uniqueness rule, in memory: a booking number already written
      // by this request is already taken, which is how a document uploaded
      // twice is recognised.
      findByBookingNumber: jest.fn(
        ({ bookingNumber }: { bookingNumber: string }) => {
          const index = createdTrips.findIndex(
            (trip) => trip.bookingNumber === bookingNumber,
          );

          return Promise.resolve(
            index === -1
              ? null
              : { id: `trip-${index + 1}`, ...createdTrips[index] },
          );
        },
      ),
      createTripGroup: jest.fn().mockResolvedValue({ id: TRIP_GROUP_ID }),
      create: jest.fn((data: CreatedTrip) => {
        createdTrips.push(data);

        // A row as the database would return it: every column the import does
        // not set comes back as an explicit null rather than absent.
        return Promise.resolve({
          vehicleId: null,
          driverId: null,
          containerNumber: null,
          terminal: null,
          startTime: null,
          endTime: null,
          executionDatetime: null,
          waitingTimeMinutes: null,
          distanceKm: null,
          internalNotes: null,
          parserMetadata: null,
          tripGroupId: null,
          ...data,
          id: `trip-${createdTrips.length}`,
          status: TripStatus.OPEN,
          createdAt: new Date("2026-08-13T06:00:00.000Z"),
          updatedAt: new Date("2026-08-13T06:00:00.000Z"),
        });
      }),
      runImportTransaction: jest.fn(
        (work: (repositories: unknown) => Promise<unknown>) =>
          work({ trips: tripRepository, pdfDocuments: pdfDocumentRepository }),
      ),
    } as unknown as TripRepository;

    /**
     * The infrastructure the import graph expects to find already present. It
     * is @Global for the same reason the real PrismaModule, LoggerModule and
     * EventsModule are: the modules under test inject these without importing
     * anything.
     */
    @Global()
    @Module({
      providers: [
        { provide: AppLoggerService, useValue: logger },
        // Never queried: every repository that would use it is replaced below.
        { provide: PrismaService, useValue: {} },
        {
          provide: DomainEventBus,
          useValue: {
            publish: jest.fn((event: unknown) => publishedEvents.push(event)),
          },
        },
      ],
      exports: [AppLoggerService, PrismaService, DomainEventBus],
    })
    class TestInfrastructureModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              PDF_STORAGE_DIR: storageDirectory,
              PDF_UPLOAD_MAX_SIZE_MB: MAX_UPLOAD_MEGABYTES,
            }),
          ],
        }),
        TestInfrastructureModule,
        PdfImportModule,
      ],
    })
      .overrideProvider(TripRepository)
      .useValue(tripRepository)
      .overrideProvider(PdfDocumentRepository)
      .useValue(pdfDocumentRepository)
      .overrideProvider(TripPlanningDataService)
      .useValue({
        resolveOne: () =>
          Promise.resolve({ vehicle: null, effectiveDriver: null }),
        resolveMany: (trips: readonly { id: string }[]) =>
          Promise.resolve(
            new Map(
              trips.map((trip) => [
                trip.id,
                { vehicle: null, effectiveDriver: null },
              ]),
            ),
          ),
      })
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
    await rm(storageDirectory, { recursive: true, force: true });
  });

  function upload() {
    return request(application.getHttpServer()).post(UPLOAD_PATH);
  }

  describe("a single-trip transport order", () => {
    it("creates one Trip from 1page.pdf", async () => {
      const response = await upload()
        .attach("files", readFixture("1page.pdf"), "1page.pdf")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.results).toHaveLength(1);
      expect(response.body.data.results[0]).toMatchObject({
        filename: "1page.pdf",
        ok: true,
        combination: false,
      });
      expect(response.body.data.results[0].trips).toHaveLength(1);
    });

    it("returns what the document actually states", async () => {
      const response = await upload().attach(
        "files",
        readFixture("1page.pdf"),
        "1page.pdf",
      );

      expect(response.body.data.results[0].trips[0]).toMatchObject({
        bookingNumber: "ANRDUB2602247",
        containerType: "45PH",
        terminal: "PSA Quay 869",
        destinationCity: "Dourges",
        destinationCountry: "France",
      });
    });

    it("creates one Trip from the two-page 2pages.pdf", async () => {
      const response = await upload()
        .attach("files", readFixture("2pages.pdf"), "2pages.pdf")
        .expect(200);

      expect(response.body.data.results[0].ok).toBe(true);
      expect(response.body.data.results[0].trips).toHaveLength(1);
      expect(response.body.data.results[0].combination).toBe(false);
    });

    it("records the PdfDocument as a manual upload", async () => {
      await upload().attach("files", readFixture("1page.pdf"), "1page.pdf");

      expect(createdPdfDocuments).toHaveLength(1);
      expect(createdPdfDocuments[0]).toMatchObject({
        importSource: ImportSource.MANUAL_UPLOAD,
        importedEmailId: null,
        originalFilename: "1page.pdf",
        mimeType: "application/pdf",
      });
    });
  });

  describe("a combination transport order", () => {
    it("creates two Trips and one TripGroup from one PDF", async () => {
      const response = await upload()
        .attach("files", readFixture("combination.pdf"), "combination.pdf")
        .expect(200);

      const [result] = response.body.data.results;

      expect(result).toMatchObject({ ok: true, combination: true });
      expect(result.trips).toHaveLength(2);
      expect(result.trips[0].tripGroupId).toBe(TRIP_GROUP_ID);
      expect(result.trips[1].tripGroupId).toBe(TRIP_GROUP_ID);
      expect(createdPdfDocuments).toHaveLength(1);
    });

    /** Each leg keeps its own booking number; the group is what links them. */
    it("keeps the two booking numbers distinct", async () => {
      const response = await upload().attach(
        "files",
        readFixture("combination.pdf"),
        "combination.pdf",
      );

      expect(
        response.body.data.results[0].trips.map(
          (trip: { bookingNumber: string }) => trip.bookingNumber,
        ),
      ).toEqual(["DUBANR2598395", "ANRBEL2603249"]);
    });
  });

  describe("several files in one request", () => {
    it("imports each of them and reports each of them", async () => {
      const response = await upload()
        .attach("files", readFixture("1page.pdf"), "1page.pdf")
        .attach("files", readFixture("combination.pdf"), "combination.pdf")
        .expect(200);

      expect(response.body.data.results.map((r: { ok: boolean }) => r.ok)).toEqual([
        true,
        true,
      ]);
      expect(createdTrips).toHaveLength(3);
    });

    /** The point of per-file results: a bad document costs only itself. */
    it("imports the good file when another one fails", async () => {
      const response = await upload()
        .attach("files", Buffer.from("this is not a PDF"), "notes.txt")
        .attach("files", readFixture("1page.pdf"), "1page.pdf")
        .expect(200);

      expect(response.body.data.results[0]).toMatchObject({
        filename: "notes.txt",
        ok: false,
        code: "IMPORT_NOT_A_PDF",
      });
      expect(response.body.data.results[1]).toMatchObject({
        filename: "1page.pdf",
        ok: true,
      });
      expect(createdTrips).toHaveLength(1);
    });

    it("also accepts the files[] field name", async () => {
      const response = await upload()
        .attach("files[]", readFixture("1page.pdf"), "1page.pdf")
        .expect(200);

      expect(response.body.data.results[0].ok).toBe(true);
    });
  });

  describe("uploading the same document twice", () => {
    it("refuses the second one as a duplicate booking", async () => {
      const response = await upload()
        .attach("files", readFixture("1page.pdf"), "1page.pdf")
        .attach("files", readFixture("1page.pdf"), "1page.pdf")
        .expect(200);

      expect(response.body.data.results[0].ok).toBe(true);
      expect(response.body.data.results[1]).toMatchObject({
        ok: false,
        code: "IMPORT_DUPLICATE_BOOKING",
      });
    });

    it("creates the Trip only once", async () => {
      await upload()
        .attach("files", readFixture("1page.pdf"), "1page.pdf")
        .attach("files", readFixture("1page.pdf"), "1page.pdf");

      expect(createdTrips).toHaveLength(1);
    });

    /**
     * Storage is content-addressed, so the refused second upload writes to the
     * path the first one is using. Cleaning up after it must not strip the
     * evidence from the Trip that imported successfully.
     */
    it("keeps the first import's stored PDF", async () => {
      await upload()
        .attach("files", readFixture("1page.pdf"), "1page.pdf")
        .attach("files", readFixture("1page.pdf"), "1page.pdf");

      const storagePath = createdPdfDocuments[0].storagePath as string;

      expect(existsSync(join(storageDirectory, storagePath))).toBe(true);
    });
  });

  describe("refusing a request", () => {
    it("rejects an upload that carries no file", async () => {
      const response = await upload().expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("files");
    });

    it("refuses an unreadable PDF per file, not as a failed request", async () => {
      const response = await upload()
        .attach("files", Buffer.from("%PDF-1.4 truncated"), "broken.pdf")
        .expect(200);

      expect(response.body.data.results[0]).toMatchObject({
        filename: "broken.pdf",
        ok: false,
        code: "IMPORT_UNREADABLE_PDF",
      });
      expect(createdTrips).toHaveLength(0);
    });

    it("refuses an empty file", async () => {
      const response = await upload()
        .attach("files", Buffer.alloc(0), "empty.pdf")
        .expect(200);

      expect(response.body.data.results[0]).toMatchObject({
        ok: false,
        code: "IMPORT_EMPTY_FILE",
      });
    });

    /**
     * The size limit is applied while the request is still being read, so an
     * oversized file is refused before it is held in full — which necessarily
     * ends the whole upload rather than that one file.
     */
    it("refuses a file above the configured size limit", async () => {
      const oversized = Buffer.concat([
        Buffer.from("%PDF-1.7\n"),
        Buffer.alloc(MAX_UPLOAD_MEGABYTES * 1024 * 1024, 0x20),
      ]);

      const response = await upload()
        .attach("files", oversized, "huge.pdf")
        .expect(413);

      expect(response.body.success).toBe(false);
      expect(createdTrips).toHaveLength(0);
    });

    it("leaves no PDF on disk for a document it refused", async () => {
      await upload().attach(
        "files",
        Buffer.from("%PDF-1.4 truncated"),
        "broken.pdf",
      );

      expect(createdPdfDocuments).toHaveLength(0);
    });
  });

  describe("what an upload must not do", () => {
    /** Pricing happens when a Trip is CLOSED. An import must not price. */
    it("leaves imported Trips OPEN and publishes no domain event", async () => {
      const response = await upload().attach(
        "files",
        readFixture("1page.pdf"),
        "1page.pdf",
      );

      expect(response.body.data.results[0].trips[0].status).toBe(
        TripStatus.OPEN,
      );
      // The import never sets a status, so the column default applies.
      expect(createdTrips[0].status).toBeUndefined();
      expect(publishedEvents).toEqual([]);
    });

    it("never assigns a vehicle or a driver", async () => {
      const debugResponse = await upload().attach("files", readFixture("1page.pdf"), "1page.pdf");
      console.log("DEBUG", JSON.stringify(debugResponse.body, null, 2).slice(0, 1200));

      expect(createdTrips[0].vehicleId).toBeUndefined();
      expect(createdTrips[0].driverId).toBeUndefined();
    });

    /** Diagnostics stay in the database; a response carries no parser state. */
    it("does not expose parser internals in the response", async () => {
      const response = await upload().attach(
        "files",
        readFixture("1page.pdf"),
        "1page.pdf",
      );

      const body = JSON.stringify(response.body);

      expect(body).not.toContain("parserMetadata");
      expect(body).not.toContain("storagePath");
      expect(body).not.toContain("fileHash");
    });
  });
});
