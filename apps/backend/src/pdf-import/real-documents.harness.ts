import { ConfigService } from "@nestjs/config";
import { TripStatus } from "@prisma/client";

import { CostConfirmationRepository } from "../cost-confirmations/cost-confirmation.repository";
import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { TripDocumentsService } from "../trips/trip-documents.service";
import { TripPlanningDataService } from "../trips/trip-planning-data.service";
import { TripRepository } from "../trips/trip.repository";
import { TripRevisionService } from "../trips/trip-revision.service";
import { TripService } from "../trips/trip.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { PdfTripImporter } from "./pdf-trip-importer.service";

/**
 * The real import graph, with the DATABASE replaced and nothing else.
 *
 * ── WHAT IS REAL HERE ───────────────────────────────────────────────────────
 * The parser, the importer, the revision service, the cancellation rules, the
 * booking-number matching, the change detection, the audit trail, the PDF
 * storage and its compensation. Files are genuinely written to a temporary
 * directory and genuinely read back.
 *
 * Only the repositories are doubles, and they keep the two behaviours the tests
 * depend on: a booking number is held by any Trip that is not deleted, and a
 * failed transaction discards everything written inside it. A double that
 * ignored either would make these tests pass for the wrong reason.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Shared by the import spec and the workflow spec, so both exercise one
 * definition of "the real system" rather than two that can drift apart.
 */

export const TRIP_GROUP_ID = "97777777-7777-4777-8777-777777777777";

export type RealDocumentHarness = ReturnType<typeof buildHarness>;

export function buildHarness(storageDirectory: string) {
  const trips: Record<string, unknown>[] = [];
  const pdfDocuments: Record<string, unknown>[] = [];
  const tripGroups: string[] = [];
  const events: unknown[] = [];
  /** Every audit-trail row written. Append-only, like the real one. */
  const history: Record<string, unknown>[] = [];
  /** Every confirmed cost written, in the order it was recorded. */
  const costConfirmations: Record<string, unknown>[] = [];

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
    findById: jest.fn((id: string) =>
      Promise.resolve(pdfDocuments.find((document) => document.id === id) ?? null),
    ),
    create: jest.fn((data: Record<string, unknown>) => {
      const document = {
        id: `pdf-${pdfDocuments.length + 1}`,
        uploadedAt: new Date("2026-08-17T06:00:00.000Z"),
        ...data,
      };
      pdfDocuments.push(document);
      return Promise.resolve(document);
    }),
    /** The compensating half of `persist`, and the only deletion there is. */
    deleteById: jest.fn((id: string) => {
      const index = pdfDocuments.findIndex((document) => document.id === id);

      if (index >= 0) {
        pdfDocuments.splice(index, 1);
      }

      return Promise.resolve();
    }),
  } as unknown as PdfDocumentRepository;

  const tripRepository = {
    /**
     * The real rule, in memory — including `excludeTripId`.
     *
     * That last part matters: reopening a cancelled Trip asks whether its own
     * booking number is free, and a double that ignored the exclusion would
     * report the Trip colliding with itself.
     */
    findByBookingNumber: jest.fn(
      ({
        bookingNumber,
        statuses,
        excludeTripId,
      }: {
        bookingNumber: string;
        statuses: readonly TripStatus[];
        excludeTripId?: string;
      }) =>
        Promise.resolve(
          trips.find(
            (trip) =>
              trip.bookingNumber === bookingNumber &&
              statuses.includes(trip.status as TripStatus) &&
              trip.id !== excludeTripId,
          ) ?? null,
        ),
    ),
    findById: jest.fn((id: string) =>
      Promise.resolve(trips.find((trip) => trip.id === id) ?? null),
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
    /**
     * Append-only, and stamped in arrival order.
     *
     * The order is what makes "the latest update" decidable, and the real
     * column has millisecond resolution — several rows of ONE update would
     * otherwise share a timestamp and the newest could not be told from the
     * one before it.
     */
    recordHistory: jest.fn((entries: Record<string, unknown>[]) => {
      for (const entry of entries) {
        history.push({
          ...entry,
          occurredAt: new Date(1_700_000_000_000 + history.length * 1_000),
        });
      }

      return Promise.resolve();
    }),
    findHistoryForTrip: jest.fn((tripId: string) =>
      Promise.resolve(
        history
          .filter((entry) => entry.tripId === tripId)
          .slice()
          .reverse()
          .map((entry) => ({
            ...entry,
            pdfDocument:
              pdfDocuments.find(
                (document) => document.id === entry.pdfDocumentId,
              ) ?? null,
          })),
      ),
    ),
    findAppliedUpdateHistory: jest.fn((tripIds: readonly string[]) =>
      Promise.resolve(
        history
          .filter(
            (entry) =>
              entry.eventType === "UPDATE_APPLIED" &&
              tripIds.includes(entry.tripId as string),
          )
          .slice()
          .reverse(),
      ),
    ),
    findPdfDocument: jest.fn((id: string) =>
      Promise.resolve(pdfDocuments.find((document) => document.id === id) ?? null),
    ),
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
     * A real transaction, in the one respect that matters: a failure inside it
     * discards everything written during it.
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

  const planningData = {
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
  } as unknown as TripPlanningDataService;

  const tripService = new TripService(
    tripRepository,
    {} as unknown as VehicleService,
    {} as unknown as DriverService,
    planningData,
    {
      publish: jest.fn((event: unknown) => events.push(event)),
    } as unknown as DomainEventBus,
    logger,
  );

  /**
   * The REAL confirmation service over an in-memory table.
   *
   * Its rules are what the tests are about — a repeat under the same number
   * changes nothing, a new number is added beside the first — so only the rows
   * are a double.
   */
  const costConfirmationService = new CostConfirmationService(
    {
      create: jest.fn((data: Record<string, unknown>) => {
        /*
         * The amount behaves like the NUMERIC the database returns: a value
         * that renders itself to a fixed-2 string and is never a float. The
         * service calls `toFixed`; a test reads it through `String`.
         */
        const fixed = Number(data.amount).toFixed(2);
        const row = {
          id: `cc-${costConfirmations.length + 1}`,
          ...data,
          amount: {
            toFixed: (digits: number) => Number(fixed).toFixed(digits),
            toString: () => fixed,
          },
        };
        costConfirmations.push(row);
        return Promise.resolve(row);
      }),
      /**
       * By TRIP: the unique constraint is on `trip_id`, so the question the
       * real repository answers is "does this Trip already have one".
       */
      findByTrip: jest.fn((tripId: string) =>
        Promise.resolve(
          costConfirmations.find((row) => row.tripId === tripId) ?? null,
        ),
      ),
      findForTrips: jest.fn((tripIds: readonly string[]) =>
        Promise.resolve(
          costConfirmations.filter((row) =>
            tripIds.includes(row.tripId as string),
          ),
        ),
      ),
    } as unknown as CostConfirmationRepository,
    logger,
  );

  const pdfDocumentService = new PdfDocumentService(
    pdfDocumentRepository,
    configService,
    logger,
  );

  return {
    importer: new PdfTripImporter(
      tripService,
      new TripRevisionService(tripRepository, logger),
      pdfDocumentService,
      costConfirmationService,
      logger,
    ),
    tripService,
    pdfDocumentService,
    documents: new TripDocumentsService(tripRepository, logger),
    /** The real resolver, for the derived `latestUpdate` a Trip reports. */
    latestUpdateOf: async (tripId: string) => {
      const service = new TripPlanningDataService(
        { findManyByIds: () => Promise.resolve(new Map()) } as unknown as VehicleService,
        { findManyByIds: () => Promise.resolve(new Map()) } as unknown as DriverService,
        {
          findDriversForVehiclesOnDates: () => Promise.resolve(new Map()),
        } as unknown as never,
        {
          findCustomPropertiesForTrips: () => Promise.resolve([]),
          findAppliedUpdateHistory: (
            tripRepository as unknown as {
              findAppliedUpdateHistory: (ids: readonly string[]) => unknown;
            }
          ).findAppliedUpdateHistory,
        } as unknown as TripRepository,
        {
          findForTrips: () => Promise.resolve(new Map()),
        } as unknown as CostConfirmationService,
      );

      const trip = trips.find((candidate) => candidate.id === tripId);
      const resolved = await service.resolveMany([trip as never]);

      return resolved.get(tripId)?.latestUpdate ?? null;
    },
    costConfirmationService,
    costConfirmations,
    trips,
    pdfDocuments,
    tripGroups,
    events,
    history,
    storageDirectory,
  };
}
