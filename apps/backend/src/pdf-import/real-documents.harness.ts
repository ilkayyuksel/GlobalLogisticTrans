import { ConfigService } from "@nestjs/config";
import { TripStatus } from "@prisma/client";

import { CostConfirmationRepository } from "../cost-confirmations/cost-confirmation.repository";
import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { bookingNumberDigits } from "../common/booking-digits";
import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { TripCustomPropertyRepository } from "../trip-custom-properties/trip-custom-property.repository";
import { AutomaticFlatPropertyService } from "../trips/automatic-flat.service";
import { FLAT_CUSTOM_PROPERTY_NAME } from "../trips/flat-container-rule";
import { TripDocumentsService } from "../trips/trip-documents.service";
import { TripPlanningDataService } from "../trips/trip-planning-data.service";
import { TripRepository } from "../trips/trip.repository";
import { TripRevisionService } from "../trips/trip-revision.service";
import { TripService } from "../trips/trip.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { CostConfirmationMatchingService } from "./cost-confirmation-matching.service";
import { PdfTripImporter } from "./pdf-trip-importer.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";

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
  /** Every Custom Property assignment, exactly as the real table holds them. */
  const customProperties: Record<string, unknown>[] = [];

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

  /**
   * The one configured Custom Property these tests need.
   *
   * Its NAME is what the rule looks it up by, and its price is what the Pricing
   * Engine would read later — neither is a literal anywhere in the rule.
   */
  const FLAT_PROPERTY = {
    id: "custom-property-flat",
    name: FLAT_CUSTOM_PROPERTY_NAME,
    defaultPrice: "80.00",
    pricingComponentId: null,
    displayOrder: 2,
    isActive: true,
  };

  const customPropertyRepository = {
    findByTripAndProperty: jest.fn((tripId: string, customPropertyId: string) =>
      Promise.resolve(
        customProperties.find(
          (row) =>
            row.tripId === tripId && row.customPropertyId === customPropertyId,
        ) ?? null,
      ),
    ),
    findByTripId: jest.fn((tripId: string) =>
      Promise.resolve(customProperties.filter((row) => row.tripId === tripId)),
    ),
    create: jest.fn((data: Record<string, unknown>) => {
      const row = {
        id: `trip-custom-property-${customProperties.length + 1}`,
        isAutomatic: false,
        ...data,
        customProperty: FLAT_PROPERTY,
        createdAt: new Date("2026-08-17T06:00:00.000Z"),
      };
      customProperties.push(row);
      return Promise.resolve(row);
    }),
    delete: jest.fn((id: string) => {
      const index = customProperties.findIndex((row) => row.id === id);
      const [removed] = customProperties.splice(index, 1);
      return Promise.resolve(removed);
    }),
  } as unknown as TripCustomPropertyRepository;

  /** The REAL rule, over the configured property above. */
  const automaticFlat = new AutomaticFlatPropertyService(
    {
      findActiveByName: jest.fn((name: string) =>
        Promise.resolve(name === FLAT_CUSTOM_PROPERTY_NAME ? FLAT_PROPERTY : null),
      ),
    } as unknown as CustomPropertyService,
    logger,
  );

  /**
   * Exact date comparison, with absence as a value rather than a wildcard.
   *
   * The stored date may be a Date or an ISO string depending on how a test
   * seeded it, so both are reduced to the same calendar day before comparing.
   */
  const sameOriginalDate = (
    trip: { originalPlanningDate?: Date | string | null },
    wanted: Date | null,
  ): boolean => {
    const stored = trip.originalPlanningDate ?? null;

    if (stored === null || wanted === null) {
      return stored === null && wanted === null;
    }

    return new Date(stored).getTime() === wanted.getTime();
  };

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
    /** Every Trip on a booking, whatever their containers — what a CC asks. */
    findManyByBookingNumber: jest.fn(
      ({
        bookingNumber,
        statuses,
      }: {
        bookingNumber: string;
        statuses: readonly TripStatus[];
      }) =>
        Promise.resolve(
          trips.filter(
            (trip) =>
              trip.bookingNumber === bookingNumber &&
              statuses.includes(trip.status as TripStatus),
          ),
        ),
    ),
    /**
     * The Cost Confirmation fallback: the same booking reduced to its digits,
     * compared by exact equality. Reached only when the lookup above found
     * nothing.
     */
    findManyByBookingDigits: jest.fn(
      ({
        digits,
        statuses,
      }: {
        digits: string;
        statuses: readonly TripStatus[];
      }) =>
        Promise.resolve(
          trips.filter(
            (trip) =>
              bookingNumberDigits(trip.bookingNumber as string | null) ===
                digits && statuses.includes(trip.status as TripStatus),
          ),
        ),
    ),
    /**
     * The real identity rule, in memory: the booking number, the container
     * number AND the original transport date, with ABSENT compared as a value
     * rather than as an unknown. A double that used `=` on the container would
     * match nothing for a collection and every test here would silently create
     * second Trips.
     */
    findByIdentity: jest.fn(
      ({
        identity,
        statuses,
        excludeTripId,
      }: {
        identity: {
          bookingNumber: string;
          containerNumber: string | null;
          originalPlanningDate: Date | null;
        };
        statuses: readonly TripStatus[];
        excludeTripId?: string;
      }) =>
        Promise.resolve(
          trips.find(
            (trip) =>
              trip.bookingNumber === identity.bookingNumber &&
              (trip.containerNumber ?? null) === identity.containerNumber &&
              sameOriginalDate(trip, identity.originalPlanningDate) &&
              statuses.includes(trip.status as TripStatus) &&
              trip.id !== excludeTripId,
          ) ?? null,
        ),
    ),
    /**
     * The booking-only half of document matching, narrowed to one transport
     * date. Deliberately separate from `findManyByBookingNumber` above, which
     * belongs to Cost Confirmations and stays date-blind.
     */
    findManyByBookingNumberAndOriginalDate: jest.fn(
      ({
        bookingNumber,
        originalPlanningDate,
        statuses,
      }: {
        bookingNumber: string;
        originalPlanningDate: Date | null;
        statuses: readonly TripStatus[];
      }) =>
        Promise.resolve(
          trips.filter(
            (trip) =>
              trip.bookingNumber === bookingNumber &&
              sameOriginalDate(trip, originalPlanningDate) &&
              statuses.includes(trip.status as TripStatus),
          ),
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
        waitingTimeStart: null,
        waitingTimeEnd: null,
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
    runTripWriteTransaction: jest.fn(
      async (work: (repositories: unknown) => Promise<unknown>) => {
        const tripCount = trips.length;
        const documentCount = pdfDocuments.length;
        const groupCount = tripGroups.length;
        const propertyRows = [...customProperties];

        try {
          return await work({
            trips: tripRepository,
            pdfDocuments: pdfDocumentRepository,
            customProperties: customPropertyRepository,
          });
        } catch (error: unknown) {
          trips.length = tripCount;
          pdfDocuments.length = documentCount;
          tripGroups.length = groupCount;
          // Restored rather than truncated: a revision may have REMOVED a row
          // inside the transaction, and a rollback puts that one back too.
          customProperties.splice(0, customProperties.length, ...propertyRows);
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
    automaticFlat,
    stubPricingRecalculation(),
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
    /*
     * The import harness is about what the DOCUMENTS produce, not about what a
     * Trip is worth: pricing has no snapshot store here. The stub keeps the
     * recording path whole while asserting nothing about money.
     */
    stubPricingRecalculation(),
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
      new TripRevisionService(tripRepository, automaticFlat, logger),
      pdfDocumentService,
      costConfirmationService,
      // The REAL matcher: which Trip a confirmation belongs to is business
      // logic, and a double here would prove nothing about it.
      new CostConfirmationMatchingService(
        tripService,
        pdfDocumentService,
        logger,
      ),
      logger,
    ),
    tripService,
    pdfDocumentService,
    /**
     * Exposed so a test can assert WHICH lookup a path used, not only what it
     * returned. Cost Confirmations must reach the date-blind booking lookup and
     * never the identity one, and only the call itself shows that.
     */
    tripRepository,
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
        {
          findForTrips: () => Promise.resolve(new Map()),
        } as unknown as EffectivePricingService,      );

      const trip = trips.find((candidate) => candidate.id === tripId);
      const resolved = await service.resolveMany([trip as never]);

      return resolved.get(tripId)?.latestUpdate ?? null;
    },
    costConfirmationService,
    costConfirmations,
    /** Every Custom Property assignment the import wrote, automatic or not. */
    customProperties,
    trips,
    pdfDocuments,
    tripGroups,
    events,
    history,
    storageDirectory,
  };
}
