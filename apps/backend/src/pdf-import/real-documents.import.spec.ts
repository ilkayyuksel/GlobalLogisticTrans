import { ConfigService } from "@nestjs/config";
import { TripStatus } from "@prisma/client";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { TripPlanningDataService } from "../trips/trip-planning-data.service";
import { TripRepository } from "../trips/trip.repository";
import { TripRevisionService } from "../trips/trip-revision.service";
import { TripService } from "../trips/trip.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { PdfTripImporter } from "./pdf-trip-importer.service";

/**
 * EVERY real transport order, through the real parser and the real importer.
 *
 * ── WHY EVERY DOCUMENT ──────────────────────────────────────────────────────
 * The three documents this pipeline was built against all behaved the same way.
 * The rest do not: two state an address the parser cannot read, one has no
 * numbered section at all, one is a Combination filed as an update, and five
 * carry a CANCELLED stamp that nothing in the import path looks at. Each of
 * those is a different path through the importer, so each gets its own case.
 *
 * Only the database is a double. The parser, the importer, the transaction
 * orchestration, the storage write and the booking-number rule are the real
 * ones — which is the point: what is asserted here is what the running system
 * does, including where it does something the business has not decided yet.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(120_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");
const TRIP_GROUP_ID = "97777777-7777-4777-8777-777777777777";

interface ExpectedImport {
  readonly file: string;
  /** Trips this document must create, in the order the importer writes them. */
  readonly bookings: readonly string[];
  readonly combination: boolean;
}

/**
 * The PLANNED orders. These are the documents that create work.
 */
const IMPORTABLE: readonly ExpectedImport[] = [
  {
    file: "NEW/1page.pdf",
    bookings: ["ANRDUB2602247"],
    combination: false,
  },
  {
    file: "NEW/2pages.pdf",
    bookings: ["ANRBEL2768902"],
    combination: false,
  },
  {
    file: "NEW/combination.pdf",
    bookings: ["DUBANR2598395", "ANRBEL2603249"],
    combination: true,
  },
  {
    file: "UPDATE/transportorder1347531.pdf",
    bookings: ["DUBANR2761223", "ANRDUB2763318"],
    combination: true,
  },
  {
    file: "UPDATE/transportorder1348827.pdf",
    bookings: ["ANRDUB2765105"],
    combination: false,
  },
  {
    // Reads its LOADING 1 section from page 2.
    file: "UPDATE/transportorder1353246.pdf",
    bookings: ["ANRDUB2770817"],
    combination: false,
  },
  {
    file: "UPDATE/transportorder1368223.pdf",
    bookings: ["ANRDUB2790449"],
    combination: false,
  },
  {
    file: "UPDATE/transportorder1368224.pdf",
    bookings: ["ANRDUB2790528"],
    combination: false,
  },
];

/**
 * The CANCELLED orders. Every one of them stamps itself in the page header, and
 * none of them may become planned work through any route.
 */
const CANCELLED_DOCUMENTS = [
  { file: "CANCEL/cancelled_transportorder1353889.pdf", booking: "ANRBEL2772352" },
  { file: "CANCEL/cancelled_transportorder1354204.pdf", booking: "ANRDUB2767189" },
  { file: "CANCEL/cancelled_transportorder1365387.pdf", booking: "DUBANR2776470" },
  { file: "CANCEL/cancelled_transportorder1367583.pdf", booking: "ANRCRK2786827" },
  { file: "CANCEL/cancelled_transportorder1367584.pdf", booking: "ANRDUB2787843" },
] as const;

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

/**
 * The import graph with the database replaced by in-memory doubles that record
 * every write, so a test can assert not only what was created but what was NOT.
 */
function buildHarness(storageDirectory: string) {
  const trips: Record<string, unknown>[] = [];
  const pdfDocuments: Record<string, unknown>[] = [];
  const tripGroups: string[] = [];
  const events: unknown[] = [];

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  const pdfDocumentRepository = {
    findByFileHash: jest.fn((fileHash: string) =>
      Promise.resolve(
        pdfDocuments.find((document) => document.fileHash === fileHash) ?? null,
      ),
    ),
    create: jest.fn((data: Record<string, unknown>) => {
      const document = { id: `pdf-${pdfDocuments.length + 1}`, ...data };
      pdfDocuments.push(document);
      return Promise.resolve(document);
    }),
  } as unknown as PdfDocumentRepository;

  const tripRepository = {
    /*
     * The real rule, in memory: a booking number is held by any Trip that is
     * not deleted. This is the ONLY thing standing between a document and a
     * duplicate import, so a double that ignored it would make every duplicate
     * test pass for the wrong reason.
     */
    findByBookingNumber: jest.fn(
      ({
        bookingNumber,
        statuses,
      }: {
        bookingNumber: string;
        statuses: readonly TripStatus[];
      }) => {
        const found = trips.find(
          (trip) =>
            trip.bookingNumber === bookingNumber &&
            statuses.includes(trip.status as TripStatus),
        );

        return Promise.resolve(found ?? null);
      },
    ),
    setStatus: jest.fn((id: string, status: TripStatus) => {
      const trip = trips.find((candidate) => candidate.id === id);
      Object.assign(trip as Record<string, unknown>, { status });
      return Promise.resolve(trip);
    }),
    update: jest.fn((id: string, data: Record<string, unknown>) => {
      const trip = trips.find((candidate) => candidate.id === id);
      Object.assign(trip as Record<string, unknown>, data);
      return Promise.resolve(trip);
    }),
    runInTransaction: jest.fn((work: (repository: unknown) => unknown) =>
      work(tripRepository),
    ),
    createTripGroup: jest.fn(() => {
      tripGroups.push(TRIP_GROUP_ID);
      return Promise.resolve({ id: TRIP_GROUP_ID });
    }),
    create: jest.fn((data: Record<string, unknown>) => {
      const trip = {
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
        id: `trip-${trips.length + 1}`,
        status: TripStatus.OPEN,
        createdAt: new Date("2026-08-17T06:00:00.000Z"),
        updatedAt: new Date("2026-08-17T06:00:00.000Z"),
      };
      trips.push(trip);
      return Promise.resolve(trip);
    }),
    /*
     * A real transaction, in the one respect that matters here: a failure
     * inside it discards everything written during it. Without this the
     * atomicity assertions below would be vacuous.
     */
    runImportTransaction: jest.fn(
      async (work: (repositories: unknown) => Promise<unknown>) => {
        const tripCount = trips.length;
        const documentCount = pdfDocuments.length;
        const groupCount = tripGroups.length;

        try {
          return await work({
            trips: tripRepository,
            pdfDocuments: pdfDocumentRepository,
          });
        } catch (error: unknown) {
          trips.length = tripCount;
          pdfDocuments.length = documentCount;
          tripGroups.length = groupCount;
          throw error;
        }
      },
    ),
  } as unknown as TripRepository;

  const configService = {
    get: jest.fn(),
    getOrThrow: jest.fn((key: string) => {
      if (key === "PDF_STORAGE_DIR") return storageDirectory;
      throw new Error(`unexpected configuration key ${key}`);
    }),
  } as unknown as ConfigService;

  const tripService = new TripService(
    tripRepository,
    {} as unknown as VehicleService,
    {} as unknown as DriverService,
    {
      resolveOne: () =>
        Promise.resolve({ vehicle: null, effectiveDriver: null }),
      resolveMany: (given: readonly { id: string }[]) =>
        Promise.resolve(
          new Map(
            given.map((trip) => [
              trip.id,
              { vehicle: null, effectiveDriver: null },
            ]),
          ),
        ),
    } as unknown as TripPlanningDataService,
    {
      publish: jest.fn((event: unknown) => events.push(event)),
    } as unknown as DomainEventBus,
    logger,
  );

  const importer = new PdfTripImporter(
    tripService,
    new TripRevisionService(tripRepository, logger),
    new PdfDocumentService(pdfDocumentRepository, configService, logger),
    logger,
  );

  return { importer, trips, pdfDocuments, tripGroups, events, storageDirectory };
}

describe("every real transport order, through the real import pipeline", () => {
  let storageDirectory: string;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-real-import-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  describe.each(IMPORTABLE)("$file", (expected) => {
    it(`creates ${expected.bookings.length} Trip(s), OPEN and unpriced`, async () => {
      const result = await harness.importer.import(
        readFixture(expected.file),
        expected.file,
      );

      expect(result.trips.map((trip) => trip.bookingNumber)).toEqual(
        expected.bookings,
      );
      expect(result.combination).toBe(expected.combination);

      for (const trip of result.trips) {
        expect(trip.status).toBe(TripStatus.OPEN);
      }

      // Importing prices nothing and closes nothing: an imported Trip is priced
      // when it is closed, through the event the Trip domain publishes then.
      expect(harness.events).toEqual([]);
    });

    it("creates exactly one PdfDocument", async () => {
      await harness.importer.import(readFixture(expected.file), expected.file);

      expect(harness.pdfDocuments).toHaveLength(1);
      expect(harness.pdfDocuments[0].originalFilename).toBe(expected.file);
    });

    it(
      expected.combination
        ? "groups its two legs into one TripGroup"
        : "creates no TripGroup",
      async () => {
        const result = await harness.importer.import(
          readFixture(expected.file),
          expected.file,
        );

        expect(harness.tripGroups).toHaveLength(expected.combination ? 1 : 0);

        const groupIds = new Set(
          harness.trips.map((trip) => trip.tripGroupId ?? null),
        );

        expect(groupIds.size).toBe(1);
        expect([...groupIds][0]).toBe(
          expected.combination ? TRIP_GROUP_ID : null,
        );

        if (expected.combination) {
          // One out, one back — the shape that makes it a Combination.
          expect(new Set(result.trips.map((trip) => trip.direction))).toEqual(
            new Set(["COLLECTION", "DELIVERY"]),
          );
        }
      },
    );

    it("stores the document under a content-addressed name", async () => {
      await harness.importer.import(readFixture(expected.file), expected.file);

      const stored = readdirSync(storageDirectory);

      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatch(/^[0-9a-f]{64}\.pdf$/);
    });

    /*
     * The duplicate rule, on every document rather than a representative one:
     * the same bytes arriving twice must not become a second Trip. Every
     * booking number in the document is already held, so the second import is
     * refused as a whole.
     */
    it("refuses the same document a second time", async () => {
      await harness.importer.import(readFixture(expected.file), expected.file);
      const afterFirst = harness.trips.length;

      await expect(
        harness.importer.import(readFixture(expected.file), expected.file),
      ).rejects.toThrow();

      expect(harness.trips).toHaveLength(afterFirst);
      expect(harness.tripGroups).toHaveLength(expected.combination ? 1 : 0);
      // The rolled-back second attempt leaves no PdfDocument behind either.
      expect(harness.pdfDocuments).toHaveLength(1);
    });

    /*
     * A renamed attachment is the same document. Storage is content-addressed,
     * so the file must not be duplicated on disk either.
     */
    it("refuses the same bytes under a different filename", async () => {
      await harness.importer.import(readFixture(expected.file), expected.file);

      await expect(
        harness.importer.import(
          readFixture(expected.file),
          "renamed-by-the-mail-client.pdf",
        ),
      ).rejects.toThrow();

      expect(harness.trips).toHaveLength(expected.bookings.length);
      expect(readdirSync(storageDirectory)).toHaveLength(1);
    });
  });

  /**
   * A document the parser cannot read must leave nothing behind — not a row,
   * not a group, and not a file. Every real order now parses, so this is proved
   * with bytes that are not a transport order at all.
   */
  describe("a document the parser refuses", () => {
    const NOT_A_PDF = new Uint8Array(
      Buffer.from("this is plainly not a transport order"),
    );

    it("is refused with a reason", async () => {
      await expect(
        harness.importer.import(NOT_A_PDF, "broken.pdf"),
      ).rejects.toThrow();
    });

    it("leaves no Trip, no TripGroup, no PdfDocument and no file", async () => {
      await expect(
        harness.importer.import(NOT_A_PDF, "broken.pdf"),
      ).rejects.toThrow();

      expect(harness.trips).toEqual([]);
      expect(harness.tripGroups).toEqual([]);
      expect(harness.pdfDocuments).toEqual([]);
      expect(readdirSync(storageDirectory)).toEqual([]);
    });
  });

  /**
   * ── A CANCELLED ORDER NEVER BECOMES PLANNED WORK ────────────────────────────
   * The document stamps itself in its page header, and the import boundary
   * honours that stamp whichever route the document arrived by. It cancels; it
   * does not create.
   * ────────────────────────────────────────────────────────────────────────────
   */
  describe.each(CANCELLED_DOCUMENTS)("$file", ({ file, booking }) => {
    it("creates no Trip, no TripGroup, no PdfDocument and no file", async () => {
      const result = await harness.importer.import(readFixture(file), file);

      expect(result.trips).toEqual([]);
      expect(harness.trips).toEqual([]);
      expect(harness.tripGroups).toEqual([]);
      expect(harness.pdfDocuments).toEqual([]);
      expect(readdirSync(storageDirectory)).toEqual([]);
    });

    it("reports the booking it names and that nothing matched it", async () => {
      const result = await harness.importer.import(readFixture(file), file);

      expect(result.cancellations).toEqual([
        { bookingNumber: booking, outcome: "NO_MATCHING_TRIP" },
      ]);
    });

    it("cancels the Trip that booking already has", async () => {
      harness.trips.push({
        id: "trip-existing",
        bookingNumber: booking,
        status: TripStatus.OPEN,
      });

      const result = await harness.importer.import(readFixture(file), file);

      expect(result.cancellations[0].outcome).toBe("CANCELLED");
      expect(harness.trips[0].status).toBe(TripStatus.CANCELLED);
      expect(harness.trips).toHaveLength(1);
    });

    it("is idempotent: cancelling twice changes nothing further", async () => {
      harness.trips.push({
        id: "trip-existing",
        bookingNumber: booking,
        status: TripStatus.OPEN,
      });

      await harness.importer.import(readFixture(file), file);
      const again = await harness.importer.import(readFixture(file), file);

      expect(again.cancellations[0].outcome).toBe("ALREADY_CANCELLED");
      expect(harness.trips).toHaveLength(1);
    });

    it("leaves a CLOSED Trip untouched", async () => {
      harness.trips.push({
        id: "trip-existing",
        bookingNumber: booking,
        status: TripStatus.CLOSED,
      });

      const result = await harness.importer.import(readFixture(file), file);

      expect(result.cancellations[0].outcome).toBe("REFUSED_CLOSED");
      expect(harness.trips[0].status).toBe(TripStatus.CLOSED);
    });

    it("prices nothing and emits nothing", async () => {
      harness.trips.push({
        id: "trip-existing",
        bookingNumber: booking,
        status: TripStatus.OPEN,
      });

      await harness.importer.import(readFixture(file), file);

      expect(harness.events).toEqual([]);
    });
  });

  /**
   * ── REVISING AN EXISTING TRIP ───────────────────────────────────────────────
   * A revision applies a later document to a Trip that already exists. It never
   * creates one, and it never stores a PdfDocument: only a NEW order does that.
   * ────────────────────────────────────────────────────────────────────────────
   */
  describe("a revised transport order", () => {
    const FILE = "UPDATE/transportorder1348827.pdf";

    it("updates the Trip that holds its booking number", async () => {
      await harness.importer.import(readFixture(FILE), FILE);
      const [created] = harness.trips;

      const result = await harness.importer.revise(readFixture(FILE), FILE);

      expect(result.revisions).toEqual([
        { bookingNumber: "ANRDUB2765105", tripId: created.id },
      ]);
      expect(harness.trips).toHaveLength(1);
    });

    it("stores no second PdfDocument and no second file", async () => {
      await harness.importer.import(readFixture(FILE), FILE);

      await harness.importer.revise(readFixture(FILE), FILE);

      expect(harness.pdfDocuments).toHaveLength(1);
      expect(readdirSync(storageDirectory)).toHaveLength(1);
    });

    it("preserves what the operator planned", async () => {
      await harness.importer.import(readFixture(FILE), FILE);
      Object.assign(harness.trips[0], {
        vehicleId: "vehicle-1",
        waitingTimeMinutes: 30,
        internalNotes: "Ring the bell at gate 4",
      });

      await harness.importer.revise(readFixture(FILE), FILE);

      expect(harness.trips[0]).toMatchObject({
        vehicleId: "vehicle-1",
        waitingTimeMinutes: 30,
        internalNotes: "Ring the bell at gate 4",
      });
    });

    it("refuses to revise a Trip nobody has, and creates none", async () => {
      await expect(
        harness.importer.revise(readFixture(FILE), FILE),
      ).rejects.toThrow(/never creates one/);

      expect(harness.trips).toEqual([]);
    });

    it("refuses to revise a CLOSED Trip", async () => {
      await harness.importer.import(readFixture(FILE), FILE);
      harness.trips[0].status = TripStatus.CLOSED;

      await expect(
        harness.importer.revise(readFixture(FILE), FILE),
      ).rejects.toThrow(/CLOSED/);
    });

    it("refuses to revise a CANCELLED Trip, and does not reopen it", async () => {
      await harness.importer.import(readFixture(FILE), FILE);
      harness.trips[0].status = TripStatus.CANCELLED;

      await expect(
        harness.importer.revise(readFixture(FILE), FILE),
      ).rejects.toThrow(/cancelled/);
      expect(harness.trips[0].status).toBe(TripStatus.CANCELLED);
    });

    it("is idempotent", async () => {
      await harness.importer.import(readFixture(FILE), FILE);

      await harness.importer.revise(readFixture(FILE), FILE);
      const afterFirst = JSON.stringify(harness.trips);
      await harness.importer.revise(readFixture(FILE), FILE);

      expect(JSON.stringify(harness.trips)).toBe(afterFirst);
    });

    it("prices nothing", async () => {
      await harness.importer.import(readFixture(FILE), FILE);

      await harness.importer.revise(readFixture(FILE), FILE);

      expect(harness.events).toEqual([]);
      expect(harness.trips[0].status).toBe(TripStatus.OPEN);
    });

    it("cancels when the document it carries is stamped CANCELLED", async () => {
      const cancelled = CANCELLED_DOCUMENTS[0];
      harness.trips.push({
        id: "trip-existing",
        bookingNumber: cancelled.booking,
        status: TripStatus.OPEN,
      });

      const result = await harness.importer.revise(
        readFixture(cancelled.file),
        cancelled.file,
      );

      expect(result.revisions).toEqual([]);
      expect(result.cancellations[0].outcome).toBe("CANCELLED");
      expect(harness.trips[0].status).toBe(TripStatus.CANCELLED);
    });
  });

  /**
   * A `CANCEL:` email cancels whatever its document names, whether or not the
   * document carries the stamp. The instruction is the sender's, addressed to
   * us; the stamp is something printed on the order. Both are honoured, each
   * from its own source.
   */
  describe("a cancellation asked for by email", () => {
    it("cancels a Trip created from a PLANNED document", async () => {
      const file = "NEW/1page.pdf";
      await harness.importer.import(readFixture(file), file);

      const result = await harness.importer.cancel(readFixture(file), file);

      expect(result.cancellations).toEqual([
        { bookingNumber: "ANRDUB2602247", outcome: "CANCELLED" },
      ]);
      expect(harness.trips[0].status).toBe(TripStatus.CANCELLED);
    });

    it("cancels both legs of a Combination", async () => {
      const file = "NEW/combination.pdf";
      await harness.importer.import(readFixture(file), file);

      const result = await harness.importer.cancel(readFixture(file), file);

      expect(result.cancellations.map((entry) => entry.outcome)).toEqual([
        "CANCELLED",
        "CANCELLED",
      ]);
      expect(harness.trips.map((trip) => trip.status)).toEqual([
        TripStatus.CANCELLED,
        TripStatus.CANCELLED,
      ]);
    });

    it("creates nothing when it matches no Trip", async () => {
      const file = "NEW/1page.pdf";

      const result = await harness.importer.cancel(readFixture(file), file);

      expect(result.cancellations[0].outcome).toBe("NO_MATCHING_TRIP");
      expect(harness.trips).toEqual([]);
      expect(harness.pdfDocuments).toEqual([]);
    });
  });

  /**
   * The matching key, stated as a test: an exact booking number, and nothing
   * else. Two documents that share a destination, a date and a container type
   * are two Trips; only an identical booking number collides.
   */
  describe("how an existing Trip is identified", () => {
    it("matches on the exact booking number and on nothing else", async () => {
      await harness.importer.import(
        readFixture("UPDATE/transportorder1368223.pdf"),
        "a.pdf",
      );

      // A different booking number with everything else alike: imported.
      await harness.importer.import(
        readFixture("UPDATE/transportorder1368224.pdf"),
        "b.pdf",
      );
      expect(harness.trips).toHaveLength(2);

      // The identical booking number: refused.
      await expect(
        harness.importer.import(
          readFixture("UPDATE/transportorder1368223.pdf"),
          "c.pdf",
        ),
      ).rejects.toThrow();
      expect(harness.trips).toHaveLength(2);
    });

    it("does not match a Combination leg to its partner", async () => {
      const result = await harness.importer.import(
        readFixture("NEW/combination.pdf"),
        "combination.pdf",
      );

      // The two legs of one order carry DIFFERENT booking numbers, so neither
      // blocks the other. They are tied together by their group, not by a key.
      expect(result.trips[0].bookingNumber).not.toBe(
        result.trips[1].bookingNumber,
      );
      expect(harness.trips).toHaveLength(2);
    });
  });

  /**
   * A two-page document is ONE document. Its pages must not become separate
   * Trips, and what page 2 states must reach the Trip.
   */
  describe("a multi-page document", () => {
    it("makes one Trip from a two-page single order", async () => {
      const result = await harness.importer.import(
        readFixture("NEW/2pages.pdf"),
        "2pages.pdf",
      );

      expect(result.trips).toHaveLength(1);
      expect(harness.pdfDocuments).toHaveLength(1);
    });

    it("reads the second page of a Combination", async () => {
      const result = await harness.importer.import(
        readFixture("NEW/combination.pdf"),
        "combination.pdf",
      );

      // The collection leg is printed on page 2; without it there would be one
      // Trip, not two.
      const collection = result.trips.find(
        (trip) => trip.direction === "COLLECTION",
      );

      expect(collection?.bookingNumber).toBe("ANRBEL2603249");
      expect(collection?.destinationCity).toBe("Warneton");
    });

    /*
     * Page 1 of this order states no numbered section; its LOADING 1 section,
     * with the address AND the Date/time, is printed on page 2. One document,
     * one Trip, read from both pages.
     */
    it("reads a section printed on the other page, still as one Trip", async () => {
      const result = await harness.importer.import(
        readFixture("UPDATE/transportorder1353246.pdf"),
        "transportorder1353246.pdf",
      );

      expect(result.trips).toHaveLength(1);
      expect(result.trips[0]).toMatchObject({
        bookingNumber: "ANRDUB2770817",
        destinationCity: "Lessines",
      });
      expect(harness.pdfDocuments).toHaveLength(1);
    });
  });
});

/**
 * The uploaded documents in `storage/pdf`, which are real customer orders and
 * are deliberately not committed. Covered by invariant so a checkout without
 * them still passes; see the parser's `real-documents.spec.ts` for the same
 * reasoning.
 */
describe("an uploaded document, through the real import pipeline", () => {
  const UPLOAD_DIRECTORY = resolve(__dirname, "../../../../storage/pdf");
  const uploads = existsSync(UPLOAD_DIRECTORY)
    ? readdirSync(UPLOAD_DIRECTORY)
        .filter((name) => name.toLowerCase().endsWith(".pdf"))
        .sort()
    : [];

  let storageDirectory: string;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-upload-import-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  it("is reported when this checkout has none", () => {
    if (uploads.length === 0) {
      console.warn(
        `No uploaded PDFs in ${UPLOAD_DIRECTORY}; the committed fixtures are the whole coverage for this checkout.`,
      );
    }

    expect(Array.isArray(uploads)).toBe(true);
  });

  it.each(uploads)("%s imports into OPEN, unpriced Trips", async (name) => {
    const result = await harness.importer.import(
      new Uint8Array(readFileSync(join(UPLOAD_DIRECTORY, name))),
      name,
    );

    expect(result.trips.length).toBeGreaterThan(0);
    for (const trip of result.trips) {
      expect(trip.status).toBe(TripStatus.OPEN);
    }
    expect(harness.events).toEqual([]);
  });
});
