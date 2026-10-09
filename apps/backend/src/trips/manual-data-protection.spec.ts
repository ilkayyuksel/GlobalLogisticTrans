import { Prisma, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { TripCustomPropertyRepository } from "../trip-custom-properties/trip-custom-property.repository";
import { TripCustomPropertyService } from "../trip-custom-properties/trip-custom-property.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { FLAT_CUSTOM_PROPERTY_NAME } from "./flat-container-rule";
import { ImportedTripData } from "./import-trips.command";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRevisionService } from "./trip-revision.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * Manually managed Trip data disappears only through an explicit manual action.
 *
 * ── WHAT IS PROTECTED ───────────────────────────────────────────────────────
 * The waiting time (all four columns, including a legacy duration with no
 * times), the operator's Custom Property assignments, and the Trip's vehicle
 * and driver links.
 *
 * ── HOW THE TWO KINDS OF WRITER ARE TOLD APART ──────────────────────────────
 * Not by a flag a client could set. The automatic pipeline — PDF upload, IMAP,
 * retry, UPDATE, repeated NEW — reaches an existing Trip only through
 * `TripRevisionService`, whose write is typed as `DocumentRevisableTripFields`
 * and so cannot name a protected column at all. Only the manual endpoints —
 * the Trip PATCH and the Custom Values removal — can clear one.
 *
 * ── WHY THIS SPEC RUNS BOTH KINDS AGAINST ONE STORE ─────────────────────────
 * The interesting cases are sequences: an operator fills something in, a
 * document arrives, the operator removes it, another document arrives. The
 * real services run against a single in-memory Trip and assignment table, so
 * every later step sees exactly what the earlier ones left behind.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const BOOKING = "ANRDUB2602247";
const CONTAINER = "EUCU4550753";
const TRANSPORT_DATE = "2026-08-17";
const TRANSPORT_DATE_UTC = new Date(`${TRANSPORT_DATE}T00:00:00.000Z`);

const VEHICLE_ID = "vehicle-1";
const DRIVER_ID = "driver-1";

function customProperty(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    pricingComponentId: null,
    defaultPrice: new Prisma.Decimal("25.00"),
    displayOrder: 0,
    color: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const FLAT = customProperty("property-flat", FLAT_CUSTOM_PROPERTY_NAME);
const GENSET = customProperty("property-genset", "Genset");
const CUSTOMS = customProperty("property-customs", "Douane");
const PROPERTIES = [FLAT, GENSET, CUSTOMS];

interface Assignment {
  id: string;
  tripId: string;
  customPropertyId: string;
  isAutomatic: boolean;
  createdAt: Date;
  customProperty: (typeof PROPERTIES)[number];
}

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    pdfDocumentId: "pdf-1",
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    isLooseTrip: false,
    isPaid: false,
    direction: "COLLECTION",
    bookingNumber: BOOKING,
    containerNumber: CONTAINER,
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: TRANSPORT_DATE_UTC,
    planningDate: TRANSPORT_DATE_UTC,
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeEndsNextDay: false,
    waitingTimeMinutes: null,
    distanceKm: null,
    tarNummer: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  } as Trip;
}

/** A later document for the same transport. It knows nothing the operator did. */
function buildDocument(
  overrides: Partial<ImportedTripData> = {},
): ImportedTripData {
  return {
    bookingNumber: BOOKING,
    containerNumber: CONTAINER,
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Lessines",
    destinationCountry: "Belgium",
    planningDate: TRANSPORT_DATE,
    startTime: "07:00",
    endTime: "15:00",
    direction: "DELIVERY",
    parserMetadata: { direction: "DELIVERY" },
    ...overrides,
  };
}

function time(clock: string): Date {
  return new Date(`1970-01-01T${clock}:00.000Z`);
}

describe("manually managed Trip data", () => {
  let trip: Trip;
  let assignments: Assignment[];
  let revisions: TripRevisionService;
  let trips: TripService;
  let customValues: TripCustomPropertyService;
  let tripWrites: jest.Mock;

  beforeEach(() => {
    trip = buildTrip();
    assignments = [];
    tripWrites = jest.fn((_id: string, data: Partial<Trip>) => {
      // Prisma's own reading of the input: `undefined` leaves the column alone.
      const defined = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      );
      trip = { ...trip, ...defined } as Trip;
      return Promise.resolve(trip);
    });

    const assignmentTable = {
      findById: jest.fn((id: string) =>
        Promise.resolve(assignments.find((row) => row.id === id) ?? null),
      ),
      findByTripId: jest.fn((tripId: string) =>
        Promise.resolve(assignments.filter((row) => row.tripId === tripId)),
      ),
      findByTripAndProperty: jest.fn((tripId: string, propertyId: string) =>
        Promise.resolve(
          assignments.find(
            (row) => row.tripId === tripId && row.customPropertyId === propertyId,
          ) ?? null,
        ),
      ),
      create: jest.fn(
        (data: { tripId: string; customPropertyId: string; isAutomatic?: boolean }) => {
          const row: Assignment = {
            id: `assignment-${assignments.length + 1}-${data.customPropertyId}`,
            tripId: data.tripId,
            customPropertyId: data.customPropertyId,
            isAutomatic: data.isAutomatic ?? false,
            createdAt: new Date(),
            customProperty: PROPERTIES.find(
              (property) => property.id === data.customPropertyId,
            )!,
          };
          assignments.push(row);
          return Promise.resolve(row);
        },
      ),
      delete: jest.fn((id: string) => {
        const index = assignments.findIndex((row) => row.id === id);
        const [removed] = assignments.splice(index, 1);
        return Promise.resolve(removed);
      }),
    };

    const tripTable = {
      findById: jest.fn(() => Promise.resolve(trip)),
      findByIdentity: jest.fn(
        ({ identity }: { identity: { bookingNumber: string; containerNumber: string | null } }) =>
          Promise.resolve(
            identity.bookingNumber === trip.bookingNumber &&
              identity.containerNumber === trip.containerNumber
              ? trip
              : null,
          ),
      ),
      findManyByBookingNumberAndOriginalDate: jest.fn(
        ({ bookingNumber }: { bookingNumber: string }) =>
          Promise.resolve(bookingNumber === trip.bookingNumber ? [trip] : []),
      ),
      update: tripWrites,
      setStatus: jest.fn((_id: string, status: TripStatus) => {
        trip = { ...trip, status };
        return Promise.resolve(trip);
      }),
      recordHistory: jest.fn().mockResolvedValue(undefined),
      runInTransaction: jest.fn(),
      runTripWriteTransaction: jest.fn(),
    };
    tripTable.runInTransaction.mockImplementation(
      (work: (repository: unknown) => unknown) => work(tripTable),
    );
    tripTable.runTripWriteTransaction.mockImplementation(
      (work: (repositories: unknown) => unknown) =>
        work({
          trips: tripTable,
          pdfDocuments: {},
          customProperties: assignmentTable,
        }),
    );

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;
    const recalculation = stubPricingRecalculation();
    const propertyCatalog = {
      findActiveByName: jest.fn((name: string) =>
        Promise.resolve(PROPERTIES.find((property) => property.name === name) ?? null),
      ),
      findById: jest.fn((id: string) =>
        Promise.resolve(PROPERTIES.find((property) => property.id === id)),
      ),
    } as unknown as CustomPropertyService;
    const automaticFlat = new AutomaticFlatPropertyService(propertyCatalog, logger);

    revisions = new TripRevisionService(
      tripTable as unknown as TripRepository,
      automaticFlat,
      recalculation,
      logger,
    );
    trips = new TripService(
      tripTable as unknown as TripRepository,
      {
        findById: jest.fn().mockResolvedValue({ isActive: true }),
      } as unknown as VehicleService,
      {
        findById: jest.fn().mockResolvedValue({ isActive: true }),
      } as unknown as DriverService,
      {
        resolveOne: jest.fn().mockResolvedValue({
          vehicle: null,
          effectiveDriver: null,
          customProperties: [],
          latestUpdate: null,
          costConfirmation: null,
          pricing: null,
        }),
        resolveMany: jest.fn().mockResolvedValue(new Map()),
      } as unknown as TripPlanningDataService,
      automaticFlat,
      recalculation,
      { publish: jest.fn() } as unknown as DomainEventBus,
      logger,
    );
    customValues = new TripCustomPropertyService(
      assignmentTable as unknown as TripCustomPropertyRepository,
      trips,
      propertyCatalog,
      recalculation,
      logger,
    );
  });

  /** What the operator's afternoon of planning leaves on the Trip. */
  function planned(overrides: Partial<Trip> = {}): void {
    trip = buildTrip({
      vehicleId: VEHICLE_ID,
      driverId: DRIVER_ID,
      waitingTimeStart: time("10:00"),
      waitingTimeEnd: time("12:00"),
      waitingTimeEndsNextDay: true,
      waitingTimeMinutes: 960,
      ...overrides,
    });
  }

  async function assign(property: { id: string }): Promise<string> {
    const created = await customValues.assign({
      tripId: TRIP_ID,
      customPropertyId: property.id,
    });
    return created.id;
  }

  function waitingTime() {
    return {
      waitingTimeStart: trip.waitingTimeStart,
      waitingTimeEnd: trip.waitingTimeEnd,
      waitingTimeEndsNextDay: trip.waitingTimeEndsNextDay,
      waitingTimeMinutes: trip.waitingTimeMinutes,
    };
  }

  function assignedPropertyIds(): string[] {
    return assignments.map((row) => row.customPropertyId).sort();
  }

  describe("waiting time", () => {
    it("A: keeps a legacy 135 minutes through an UPDATE document", async () => {
      trip = buildTrip({ waitingTimeMinutes: 135 });

      await revisions.applyDocumentRevision(buildDocument());

      expect(waitingTime()).toEqual({
        waitingTimeStart: null,
        waitingTimeEnd: null,
        waitingTimeEndsNextDay: false,
        waitingTimeMinutes: 135,
      });
    });

    it("B: keeps a full window with Volgende dag through a revision", async () => {
      planned();

      await revisions.applyDocumentRevision(buildDocument());

      expect(waitingTime()).toEqual({
        waitingTimeStart: time("10:00"),
        waitingTimeEnd: time("12:00"),
        waitingTimeEndsNextDay: true,
        waitingTimeMinutes: 960,
      });
    });

    it("C: keeps it through a detail-form save that does not mention it", async () => {
      trip = buildTrip({ waitingTimeMinutes: 135 });

      await trips.update(TRIP_ID, {
        internalNotes: "Call before arriving",
        distanceKm: 120,
      });

      expect(trip.waitingTimeMinutes).toBe(135);
    });

    it("D: is cleared by the explicit removal", async () => {
      trip = buildTrip({ waitingTimeMinutes: 135 });

      await trips.update(TRIP_ID, {
        waitingTimeStart: null,
        waitingTimeEnd: null,
      });

      expect(waitingTime()).toEqual({
        waitingTimeStart: null,
        waitingTimeEnd: null,
        waitingTimeEndsNextDay: false,
        waitingTimeMinutes: null,
      });
    });

    it("E: survives a repeated NEW and a second delivery of the same NEW", async () => {
      planned();

      await revisions.applyNewOrder(buildDocument());
      await revisions.applyNewOrder(buildDocument());

      expect(trip.waitingTimeMinutes).toBe(960);
      expect(trip.waitingTimeEndsNextDay).toBe(true);
    });

    it("stays removed when a later document arrives", async () => {
      planned();
      await trips.update(TRIP_ID, { waitingTimeStart: null, waitingTimeEnd: null });

      await revisions.applyDocumentRevision(buildDocument());
      await revisions.applyNewOrder(buildDocument());

      expect(trip.waitingTimeMinutes).toBeNull();
      expect(trip.waitingTimeStart).toBeNull();
    });

    /* The 06:00–20:00 rule is untouched: a manual window still derives it. */
    it("still derives the counted minutes from a manual window", async () => {
      await trips.update(TRIP_ID, {
        waitingTimeStart: "10:00",
        waitingTimeEnd: "08:00",
        waitingTimeEndsNextDay: true,
      });

      expect(trip.waitingTimeMinutes).toBe(12 * 60);
    });
  });

  describe("Custom Values", () => {
    it("F: keeps a manual assignment through an UPDATE document", async () => {
      await assign(GENSET);

      await revisions.applyDocumentRevision(buildDocument());

      expect(assignedPropertyIds()).toEqual([GENSET.id]);
    });

    it("G: keeps several manual assignments, Flat among them", async () => {
      await assign(GENSET);
      await assign(CUSTOMS);
      // Flat assigned by hand on a type that does not require it.
      await assignmentWrite(FLAT, false);

      await revisions.applyDocumentRevision(buildDocument());
      await revisions.applyNewOrder(buildDocument());

      expect(assignedPropertyIds()).toEqual(
        [CUSTOMS.id, FLAT.id, GENSET.id].sort(),
      );
    });

    it("H: is removed through the Custom Values popup", async () => {
      const assignmentId = await assign(GENSET);

      await customValues.remove(assignmentId);

      expect(assignedPropertyIds()).toEqual([]);
    });

    it("I: does not come back with a later document", async () => {
      const removedId = await assign(GENSET);
      await assign(CUSTOMS);
      await customValues.remove(removedId);

      await revisions.applyDocumentRevision(buildDocument());
      await revisions.applyNewOrder(buildDocument());

      expect(assignedPropertyIds()).toEqual([CUSTOMS.id]);
    });

    describe("J: the system-managed Flat rule is unchanged", () => {
      it("adds Flat automatically when a document makes the type require it", async () => {
        await revisions.applyDocumentRevision(buildDocument({ containerType: "40FL" }));

        expect(assignments).toEqual([
          expect.objectContaining({ customPropertyId: FLAT.id, isAutomatic: true }),
        ]);
      });

      it("withdraws only the automatic Flat when the type no longer requires it", async () => {
        trip = buildTrip({ containerType: "40FL" });
        await assignmentWrite(FLAT, true);

        await revisions.applyDocumentRevision(buildDocument({ containerType: "45PH" }));

        expect(assignments).toEqual([]);
      });

      it("keeps a manual Flat when the type no longer requires it", async () => {
        trip = buildTrip({ containerType: "40FL" });
        await assignmentWrite(FLAT, false);

        await revisions.applyDocumentRevision(buildDocument({ containerType: "45PH" }));

        expect(assignedPropertyIds()).toEqual([FLAT.id]);
      });

      it("still refuses manual removal of a Flat the type requires", async () => {
        trip = buildTrip({ containerType: "40FL" });
        const flat = await assignmentWrite(FLAT, true);

        await expect(customValues.remove(flat)).rejects.toThrow();
        expect(assignedPropertyIds()).toEqual([FLAT.id]);
      });
    });
  });

  describe("driver and vehicle", () => {
    it("K: keeps the driver through an UPDATE document", async () => {
      planned();

      await revisions.applyDocumentRevision(buildDocument());

      expect(trip.driverId).toBe(DRIVER_ID);
    });

    it("L: keeps the vehicle through an UPDATE document", async () => {
      planned();

      await revisions.applyDocumentRevision(buildDocument());

      expect(trip.vehicleId).toBe(VEHICLE_ID);
    });

    it("M: is unlinked by an explicit manual unassign", async () => {
      planned();

      await trips.update(TRIP_ID, { vehicleId: null, driverId: null });

      expect(trip.vehicleId).toBeNull();
      expect(trip.driverId).toBeNull();
    });

    it("lets the operator choose a different vehicle", async () => {
      planned();

      await trips.update(TRIP_ID, { vehicleId: "vehicle-2" });

      expect(trip.vehicleId).toBe("vehicle-2");
    });

    it("N: does not come back with a later document", async () => {
      planned();
      await trips.update(TRIP_ID, { vehicleId: null, driverId: null });

      await revisions.applyDocumentRevision(buildDocument());
      await revisions.applyNewOrder(buildDocument());

      expect(trip.vehicleId).toBeNull();
      expect(trip.driverId).toBeNull();
    });
  });

  describe("integration", () => {
    /*
     * A document cannot even express these fields — `ImportedTripData` has no
     * such members. The cast forces them in anyway, as nulls, to prove that
     * the write ignores whatever a payload carries beyond its own fields.
     */
    it("O: a revision that carries nulls for every protected field erases none", async () => {
      planned();
      await assign(GENSET);
      const hostile = {
        ...buildDocument(),
        vehicleId: null,
        driverId: null,
        waitingTimeStart: null,
        waitingTimeEnd: null,
        waitingTimeEndsNextDay: false,
        waitingTimeMinutes: null,
        customProperties: [],
      } as unknown as ImportedTripData;

      await revisions.applyDocumentRevision(hostile);

      expect(trip).toMatchObject({
        vehicleId: VEHICLE_ID,
        driverId: DRIVER_ID,
        waitingTimeEndsNextDay: true,
        waitingTimeMinutes: 960,
      });
      expect(assignedPropertyIds()).toEqual([GENSET.id]);
      for (const [, written] of tripWrites.mock.calls) {
        for (const field of [
          "vehicleId",
          "driverId",
          "waitingTimeStart",
          "waitingTimeEnd",
          "waitingTimeEndsNextDay",
          "waitingTimeMinutes",
        ]) {
          expect(written).not.toHaveProperty(field);
        }
      }
    });

    it("P: the same NEW delivered twice changes nothing the operator owns", async () => {
      planned();
      await assign(GENSET);
      await revisions.applyNewOrder(buildDocument());
      const afterFirst = { ...trip };

      await revisions.applyNewOrder(buildDocument());

      expect(trip).toEqual(afterFirst);
      expect(assignedPropertyIds()).toEqual([GENSET.id]);
    });

    it("Q: the document's own fields still move", async () => {
      planned();

      const result = await revisions.applyDocumentRevision(
        buildDocument({ terminal: "Deurganck", destinationCity: "Lille" }),
      );

      expect(result.outcome).toBe("UPDATED");
      expect(trip).toMatchObject({
        terminal: "Deurganck",
        destinationCity: "Lille",
        destinationCountry: "Belgium",
        direction: "DELIVERY",
        startTime: time("07:00"),
        vehicleId: VEHICLE_ID,
        waitingTimeMinutes: 960,
      });
    });

    it("reopens a cancelled Trip with every protected value intact", async () => {
      planned({ status: TripStatus.CANCELLED });
      await assign(GENSET);

      const result = await revisions.applyDocumentRevision(buildDocument());

      expect(result.outcome).toBe("REOPENED");
      expect(trip).toMatchObject({
        status: TripStatus.OPEN,
        vehicleId: VEHICLE_ID,
        driverId: DRIVER_ID,
        waitingTimeMinutes: 960,
      });
      expect(assignedPropertyIds()).toEqual([GENSET.id]);
    });
  });

  /** A row as an earlier rule or an earlier operator left it. */
  async function assignmentWrite(
    property: (typeof PROPERTIES)[number],
    isAutomatic: boolean,
  ): Promise<string> {
    const row: Assignment = {
      id: `seeded-${property.id}`,
      tripId: TRIP_ID,
      customPropertyId: property.id,
      isAutomatic,
      createdAt: new Date(),
      customProperty: property,
    };
    assignments.push(row);
    return Promise.resolve(row.id);
  }
});
