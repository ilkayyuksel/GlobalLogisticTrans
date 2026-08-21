import { ImportSource, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { VehicleService } from "../vehicles/vehicle.service";
import { DuplicateBookingNumberException } from "./exceptions/trip.exceptions";
import { ImportTripsCommand, ImportedTripData } from "./import-trips.command";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";
import { TripPlanningDataService } from "./trip-planning-data.service";

/**
 * The internal import path.
 *
 * Everything asserted here is about atomicity and about the two fields the
 * public contract withholds. The parser is not involved: this proves what the
 * Trip domain does with facts, not how the facts were read.
 */

const PDF_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const GROUP_ID = "7e0f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    pdfDocumentId: PDF_ID,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    direction: null,
    bookingNumber: "ANRDUB2602247",
    containerNumber: null,
    containerType: "45PH",
    terminal: "PSA Antwerp",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
    planningDate: new Date("2025-05-22T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function buildImportedTrip(
  overrides: Partial<ImportedTripData> = {},
): ImportedTripData {
  return {
    bookingNumber: "ANRDUB2602247",
    containerNumber: null,
    containerType: "45PH",
    terminal: "PSA Antwerp",
    destinationCity: "Dourges",
    destinationCountry: "France",
    planningDate: "2025-05-22",
    startTime: "10:00",
    endTime: "16:00",
    // The document said which half of the transport this is. It is stored on
    // the Trip AND kept in parser_metadata as evidence.
    direction: "COLLECTION",
    parserMetadata: { direction: "COLLECTION" },
    ...overrides,
  };
}

function buildCommand(
  overrides: Partial<ImportTripsCommand> = {},
): ImportTripsCommand {
  return {
    document: {
      kind: "new",
      data: {
        importSource: ImportSource.MANUAL_UPLOAD,
        originalFilename: "order.pdf",
        storagePath: "abc123.pdf",
        fileSizeBytes: BigInt(2048),
        fileHash: "abc123",
        mimeType: "application/pdf",
      },
    },
    asCombination: false,
    trips: [buildImportedTrip()],
    ...overrides,
  };
}

describe("TripService.importTrips", () => {
  let repository: jest.Mocked<TripRepository>;
  let pdfDocuments: jest.Mocked<PdfDocumentRepository>;
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let eventBus: { publish: jest.Mock };
  let service: TripService;

  beforeEach(() => {
    pdfDocuments = {
      findByFileHash: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: PDF_ID }),
    } as unknown as jest.Mocked<PdfDocumentRepository>;

    repository = {
      findByBookingNumber: jest.fn().mockResolvedValue(null),
      createTripGroup: jest.fn().mockResolvedValue({ id: GROUP_ID }),
      create: jest.fn().mockImplementation((data) =>
        Promise.resolve(
          buildTrip({
            bookingNumber: data.bookingNumber,
            tripGroupId: data.tripGroupId ?? null,
          }),
        ),
      ),
      runImportTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripRepository>;

    // The real transaction hands the callback repositories bound to it; the
    // double passes the same ones through so every call stays observable.
    (repository.runImportTransaction as jest.Mock).mockImplementation(
      (work: (repos: unknown) => Promise<unknown>) =>
        work({ trips: repository, pdfDocuments }),
    );

    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };

    service = new TripService(
      repository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      {
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
      } as unknown as TripPlanningDataService,
      eventBus as unknown as DomainEventBus,
      logger as unknown as AppLoggerService,
    );
  });

  it("writes the document and the Trips in one transaction", async () => {
    await service.importTrips(buildCommand());

    expect(repository.runImportTransaction).toHaveBeenCalledTimes(1);
    expect(pdfDocuments.create).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("links every Trip to the document created in the same transaction", async () => {
    await service.importTrips(buildCommand());

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ pdfDocumentId: PDF_ID }),
    );
  });

  it("creates no group for a single Trip", async () => {
    await service.importTrips(buildCommand());

    expect(repository.createTripGroup).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ tripGroupId: null }),
    );
  });

  it("puts both Trips of a Combination in one group", async () => {
    await service.importTrips(
      buildCommand({
        asCombination: true,
        trips: [
          buildImportedTrip({ bookingNumber: "DUBANR2598395" }),
          buildImportedTrip({ bookingNumber: "ANRBEL2603249" }),
        ],
      }),
    );

    expect(repository.createTripGroup).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tripGroupId: GROUP_ID }),
    );
    expect(repository.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tripGroupId: GROUP_ID }),
    );
  });

  /**
   * The rule the real transport orders establish: a Combination pairs an
   * inbound booking with an outbound one, so the two Trips carry DIFFERENT
   * numbers. They are linked by their TripGroup, and booking-number uniqueness
   * applies to each of them independently — there is no exception for a
   * Combination, and `assertBookingNumberFree` is not weakened for one.
   */
  describe("the booking numbers of a Combination", () => {
    const DELIVERY_BOOKING = "DUBANR2598395";
    const COLLECTION_BOOKING = "ANRBEL2603249";

    function buildRealCombination() {
      return buildCommand({
        asCombination: true,
        trips: [
          buildImportedTrip({ bookingNumber: DELIVERY_BOOKING }),
          buildImportedTrip({ bookingNumber: COLLECTION_BOOKING }),
        ],
      });
    }

    it("keeps each Trip's own booking number", async () => {
      await service.importTrips(buildRealCombination());

      expect(repository.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ bookingNumber: DELIVERY_BOOKING }),
      );
      expect(repository.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ bookingNumber: COLLECTION_BOOKING }),
      );
    });

    it("links the two Trips through the group, not through the booking", async () => {
      await service.importTrips(buildRealCombination());

      const [first, second] = (repository.create as jest.Mock).mock.calls.map(
        ([data]) => data,
      );

      expect(first.bookingNumber).not.toBe(second.bookingNumber);
      expect(first.tripGroupId).toBe(second.tripGroupId);
      expect(first.tripGroupId).toBe(GROUP_ID);
    });

    it("checks uniqueness for each Trip independently", async () => {
      await service.importTrips(buildRealCombination());

      expect(repository.findByBookingNumber).toHaveBeenCalledTimes(2);
      expect(repository.findByBookingNumber).toHaveBeenCalledWith(
        expect.objectContaining({ bookingNumber: DELIVERY_BOOKING }),
      );
      expect(repository.findByBookingNumber).toHaveBeenCalledWith(
        expect.objectContaining({ bookingNumber: COLLECTION_BOOKING }),
      );
    });

    /**
     * The second leg is checked after the first is written, so the check has to
     * see rows the transaction has not committed yet. The double models that
     * visibility; the real guarantee comes from running inside the transaction.
     */
    it("refuses a second leg repeating the first leg's booking number", async () => {
      const written: string[] = [];

      (repository.create as jest.Mock).mockImplementation((data) => {
        written.push(data.bookingNumber);
        return Promise.resolve(
          buildTrip({ bookingNumber: data.bookingNumber }),
        );
      });
      (repository.findByBookingNumber as jest.Mock).mockImplementation(
        ({ bookingNumber }) =>
          Promise.resolve(
            written.includes(bookingNumber)
              ? buildTrip({ bookingNumber })
              : null,
          ),
      );

      await expect(
        service.importTrips(
          buildCommand({
            asCombination: true,
            trips: [
              buildImportedTrip({ bookingNumber: DELIVERY_BOOKING }),
              buildImportedTrip({ bookingNumber: DELIVERY_BOOKING }),
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(DuplicateBookingNumberException);
    });
  });

  it("stores the parser metadata the public contract refuses to accept", async () => {
    await service.importTrips(
      buildCommand({
        trips: [
          buildImportedTrip({
            parserMetadata: { direction: "DELIVERY", groupKey: null },
          }),
        ],
      }),
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parserMetadata: { direction: "DELIVERY", groupKey: null },
      }),
    );
  });

  it("converts the parser's calendar date and times to UTC", async () => {
    await service.importTrips(buildCommand());

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        planningDate: new Date("2025-05-22T00:00:00.000Z"),
        originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
      }),
    );
  });

  it("keeps a missing time null rather than inventing one", async () => {
    await service.importTrips(
      buildCommand({
        trips: [buildImportedTrip({ startTime: null, endTime: null })],
      }),
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: null, endTime: null }),
    );
  });

  it("imports Trips as OPEN and never assigns a vehicle or driver", async () => {
    await service.importTrips(buildCommand());

    const written = (repository.create as jest.Mock).mock.calls[0][0];

    expect(written.status).toBeUndefined();
    expect(written.vehicleId).toBeUndefined();
    expect(written.driverId).toBeUndefined();
  });

  it("does not price an imported Trip", async () => {
    await service.importTrips(buildCommand());

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it("refuses a booking number already held by another Trip", async () => {
    (repository.findByBookingNumber as jest.Mock).mockResolvedValue(
      buildTrip(),
    );

    await expect(service.importTrips(buildCommand())).rejects.toBeInstanceOf(
      DuplicateBookingNumberException,
    );
  });

  it("checks the booking number before writing anything", async () => {
    (repository.findByBookingNumber as jest.Mock).mockResolvedValue(
      buildTrip(),
    );

    await expect(service.importTrips(buildCommand())).rejects.toThrow();

    expect(repository.create).not.toHaveBeenCalled();
  });

  /**
   * The second Trip of a Combination is checked after the first is written, so
   * the check has to see uncommitted rows. Running inside the transaction is
   * what makes that true; this proves the second one is checked at all.
   */
  it("checks the booking number of every Trip in a Combination", async () => {
    await service.importTrips(
      buildCommand({
        asCombination: true,
        trips: [
          buildImportedTrip({ bookingNumber: "DUBANR2598395" }),
          buildImportedTrip({ bookingNumber: "ANRBEL2603249" }),
        ],
      }),
    );

    expect(repository.findByBookingNumber).toHaveBeenCalledWith(
      expect.objectContaining({ bookingNumber: "DUBANR2598395" }),
    );
    expect(repository.findByBookingNumber).toHaveBeenCalledWith(
      expect.objectContaining({ bookingNumber: "ANRBEL2603249" }),
    );
  });

  it("lets the transaction fail rather than writing a partial Combination", async () => {
    (repository.create as jest.Mock)
      .mockResolvedValueOnce(buildTrip())
      .mockRejectedValueOnce(new Error("insert failed"));

    await expect(
      service.importTrips(
        buildCommand({
          asCombination: true,
          trips: [
            buildImportedTrip({ bookingNumber: "DUBANR2598395" }),
            buildImportedTrip({ bookingNumber: "ANRBEL2603249" }),
          ],
        }),
      ),
    ).rejects.toThrow("insert failed");
  });

  it("logs identifiers only, never the booking number or destination", async () => {
    await service.importTrips(buildCommand());

    const logged = JSON.stringify(logger.log.mock.calls);

    expect(logged).not.toContain("ANRDUB2602247");
    expect(logged).not.toContain("Dourges");
  });
});
