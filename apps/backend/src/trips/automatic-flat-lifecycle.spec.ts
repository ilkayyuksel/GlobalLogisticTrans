import { Trip, TripStatus } from "@prisma/client";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripCustomPropertyRepository } from "../trip-custom-properties/trip-custom-property.repository";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { FLAT_CUSTOM_PROPERTY_NAME } from "./flat-container-rule";
import { ImportedTripData } from "./import-trips.command";
import { TripRepository } from "./trip.repository";
import { TripRevisionService } from "./trip-revision.service";

const FLAT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const TAR_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const BOOKING = "ANRDUB2602247";

const FLAT_PROPERTY = {
  id: FLAT_ID,
  name: FLAT_CUSTOM_PROPERTY_NAME,
  defaultPrice: "80.00",
  pricingComponentId: null,
  isActive: true,
};

/**
 * What happens to Flat when a document changes the container type.
 *
 * ── WHY THIS IS A LIFECYCLE AND NOT A CALCULATION ───────────────────────────
 * An order is revised more than once, and the container type is one of the
 * fields a revision may move. Each move has to leave the Trip carrying exactly
 * what its CURRENT type obliges — not what its first document said, and not the
 * union of everything it has ever been. A stale Flat is an invoice line for
 * handling nobody did.
 *
 * The one thing a revision may never do is undo a person's work. An operator
 * who assigned Flat by hand keeps it through every container-type change there
 * is, because the document knows nothing about why they did it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The revision service and the rule are both real; only the two tables are in
 * memory, and the transaction they share behaves like one — a failure inside it
 * discards everything written during it.
 */
describe("Flat through a Trip's revisions", () => {
  let trip: Trip;
  let assignments: {
    id: string;
    tripId: string;
    customPropertyId: string;
    isAutomatic: boolean;
  }[];
  let service: TripRevisionService;

  beforeEach(() => {
    assignments = [];
    trip = buildTrip("45PH");

    const customPropertyRepository = {
      findByTripAndProperty: jest.fn((tripId: string, propertyId: string) =>
        Promise.resolve(
          assignments.find(
            (row) => row.tripId === tripId && row.customPropertyId === propertyId,
          ) ?? null,
        ),
      ),
      create: jest.fn((data: Record<string, unknown>) => {
        const row = {
          id: `assignment-${assignments.length + 1}`,
          isAutomatic: false,
          ...data,
        } as (typeof assignments)[number];
        assignments.push(row);
        return Promise.resolve(row);
      }),
      delete: jest.fn((id: string) => {
        const index = assignments.findIndex((row) => row.id === id);
        const [removed] = assignments.splice(index, 1);
        return Promise.resolve(removed);
      }),
    } as unknown as TripCustomPropertyRepository;

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    const repository = {
      findByBookingNumber: jest.fn(({ bookingNumber }: { bookingNumber: string }) =>
        Promise.resolve(bookingNumber === trip.bookingNumber ? trip : null),
      ),
      update: jest.fn((_id: string, data: Partial<Trip>) => {
        trip = { ...trip, ...data };
        return Promise.resolve(trip);
      }),
      recordHistory: jest.fn().mockResolvedValue(undefined),
      runTripWriteTransaction: jest.fn(
        (work: (repositories: unknown) => Promise<unknown>) =>
          work({
            trips: repository,
            pdfDocuments: {},
            customProperties: customPropertyRepository,
          }),
      ),
    } as unknown as TripRepository;

    service = new TripRevisionService(
      repository,
      new AutomaticFlatPropertyService(
        {
          findActiveByName: jest.fn((name: string) =>
            Promise.resolve(
              name === FLAT_CUSTOM_PROPERTY_NAME ? FLAT_PROPERTY : null,
            ),
          ),
        } as unknown as CustomPropertyService,
        logger,
      ),
      logger,
    );
  });

  function buildTrip(containerType: string): Trip {
    return {
      id: "trip-1",
      bookingNumber: BOOKING,
      status: TripStatus.OPEN,
      containerType,
      containerNumber: "MSKU1234567",
      terminal: "PSA Quay 869",
      destinationCity: "Dourges",
      destinationCountry: "France",
      planningDate: new Date("2026-08-17T00:00:00.000Z"),
      originalPlanningDate: new Date("2026-08-17T00:00:00.000Z"),
      startTime: null,
      endTime: null,
      direction: null,
      parserMetadata: null,
    } as unknown as Trip;
  }

  /** The same order again, with a different container type on it. */
  function revisionWith(containerType: string): ImportedTripData {
    return {
      bookingNumber: BOOKING,
      containerNumber: "MSKU1234567",
      containerType,
      terminal: "PSA Quay 869",
      destinationCity: "Dourges",
      destinationCountry: "France",
      planningDate: "2026-08-17",
      startTime: null,
      endTime: null,
      direction: null,
      parserMetadata: null,
    } as unknown as ImportedTripData;
  }

  function given(customPropertyId: string, isAutomatic: boolean) {
    const row = {
      id: `existing-${assignments.length + 1}`,
      tripId: "trip-1",
      customPropertyId,
      isAutomatic,
    };
    assignments.push(row);

    return row;
  }

  function flat() {
    return assignments.find((row) => row.customPropertyId === FLAT_ID);
  }

  describe("a revision that makes the Trip a flat rack", () => {
    it.each(["20FL", "20ST"])(
      "assigns Flat when 45PH becomes %s",
      async (containerType) => {
        await service.applyDocumentRevision(revisionWith(containerType));

        expect(trip.containerType).toBe(containerType);
        expect(flat()).toMatchObject({ isAutomatic: true });
      },
    );

    it("assigns it once, however many revisions arrive", async () => {
      await service.applyDocumentRevision(revisionWith("20FL"));
      await service.applyDocumentRevision(revisionWith("20ST"));
      await service.applyDocumentRevision(revisionWith("20FL"));

      expect(assignments).toHaveLength(1);
    });
  });

  describe("a revision that makes it something else", () => {
    it.each(["45PH", "45OS", "45RH"])(
      "removes the automatic Flat when 20FL becomes %s",
      async (containerType) => {
        trip = buildTrip("20FL");
        given(FLAT_ID, true);

        await service.applyDocumentRevision(revisionWith(containerType));

        expect(flat()).toBeUndefined();
      },
    );

    it("removes it when 20ST becomes 45OS", async () => {
      trip = buildTrip("20ST");
      given(FLAT_ID, true);

      await service.applyDocumentRevision(revisionWith("45OS"));

      expect(flat()).toBeUndefined();
    });

    /**
     * The line this rule may not cross. The operator assigned Flat for a reason
     * this document has no view on, and a container type changing is not an
     * instruction to undo their work.
     */
    it("keeps a manually assigned Flat", async () => {
      trip = buildTrip("20FL");
      const manual = given(FLAT_ID, false);

      await service.applyDocumentRevision(revisionWith("45PH"));

      expect(flat()).toEqual(manual);
    });

    it("leaves every other property where it is", async () => {
      trip = buildTrip("20FL");
      const tar = given(TAR_ID, false);
      given(FLAT_ID, true);

      await service.applyDocumentRevision(revisionWith("45PH"));

      expect(assignments).toEqual([tar]);
    });
  });

  describe("a revision that changes something else entirely", () => {
    it("leaves a 20FL Trip's Flat alone", async () => {
      trip = buildTrip("20FL");
      const existing = given(FLAT_ID, true);

      await service.applyDocumentRevision({
        ...revisionWith("20FL"),
        containerNumber: "TCLU9999999",
      });

      expect(assignments).toEqual([existing]);
    });

    it("assigns nothing to a 45PH Trip", async () => {
      await service.applyDocumentRevision({
        ...revisionWith("45PH"),
        containerNumber: "TCLU9999999",
      });

      expect(assignments).toEqual([]);
    });
  });

  /**
   * A revision that is refused never reaches the rule: the Trip's fields are
   * not written either, and a CLOSED Trip's properties are part of what was
   * invoiced.
   */
  describe("a revision that is refused", () => {
    it.each([TripStatus.CLOSED, TripStatus.CANCELLED])(
      "changes nothing on a %s Trip",
      async (status) => {
        trip = { ...buildTrip("45PH"), status };

        await service.applyDocumentRevision(revisionWith("20FL"));

        expect(trip.containerType).toBe("45PH");
        expect(assignments).toEqual([]);
      },
    );

    it("leaves a CLOSED 20FL Trip's Flat exactly as it was", async () => {
      trip = { ...buildTrip("20FL"), status: TripStatus.CLOSED };
      const existing = given(FLAT_ID, true);

      await service.applyDocumentRevision(revisionWith("45PH"));

      expect(assignments).toEqual([existing]);
    });
  });
});
