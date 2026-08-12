import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Prisma, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { TRIP_CLOSED_EVENT, TripClosedEvent } from "./events/trip-closed.event";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    pdfDocumentId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    bookingNumber: "BK-2026-0042",
    containerNumber: null,
    containerType: "45PH",
    terminal: "Antwerp",
    destinationCity: "Rotterdam",
    destinationCountry: "Netherlands",
    originalPlanningDate: new Date("2026-08-17T00:00:00Z"),
    planningDate: new Date("2026-08-17T00:00:00Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  } as unknown as Trip;
}

/**
 * The Trip lifecycle announces a fact; pricing reacts to it on its own side.
 * These tests pin the two halves of that boundary: exactly when the fact is
 * announced, and that the Trip module still knows nothing about pricing.
 */
describe("TripService — TripClosed event", () => {
  let repository: jest.Mocked<TripRepository>;
  let eventBus: { publish: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: TripService;

  /** Records the order of the commit and the publish. */
  let journal: string[];

  beforeEach(() => {
    journal = [];

    repository = {
      findById: jest.fn().mockResolvedValue(buildTrip()),
      findByBookingNumber: jest.fn().mockResolvedValue(null),
      findVehicleOverlaps: jest.fn().mockResolvedValue([]),
      setStatus: jest.fn(),
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripRepository>;

    (repository.setStatus as jest.Mock).mockImplementation(
      async (_id: string, status: TripStatus) => buildTrip({ status }),
    );

    (repository.runInTransaction as jest.Mock).mockImplementation(
      async (work: (repo: TripRepository) => Promise<unknown>) => {
        const result = await work(repository);
        journal.push("commit");
        return result;
      },
    );

    eventBus = {
      publish: jest.fn().mockImplementation(async () => {
        journal.push("publish");
      }),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new TripService(
      repository,
      { findById: jest.fn() } as unknown as VehicleService,
      { findById: jest.fn() } as unknown as DriverService,
      eventBus as unknown as DomainEventBus,
      logger as unknown as AppLoggerService,
    );
  });

  describe("when the event is emitted", () => {
    it("emits exactly one TripClosed on OPEN -> CLOSED", async () => {
      await service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED });

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      expect(eventBus.publish).toHaveBeenCalledWith(
        new TripClosedEvent(TRIP_ID),
      );
    });

    it("emits nothing on OPEN -> CANCELLED", async () => {
      await service.changeStatus(TRIP_ID, { status: TripStatus.CANCELLED });

      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it("emits nothing on CANCELLED -> OPEN", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CANCELLED }),
      );

      await service.changeStatus(TRIP_ID, { status: TripStatus.OPEN });

      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it("emits nothing when the status does not change", async () => {
      // CLOSED -> CLOSED returns early; nothing was transitioned.
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED }),
      );

      await service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED });

      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    it.each([
      [TripStatus.CLOSED, TripStatus.OPEN, "CLOSED is terminal"],
      [TripStatus.CANCELLED, TripStatus.CLOSED, "CANCELLED cannot close"],
      [TripStatus.DELETED, TripStatus.CLOSED, "DELETED cannot close"],
    ])(
      "emits nothing for the rejected transition %s -> %s (%s)",
      async (from, to, _reason) => {
        repository.findById.mockResolvedValue(buildTrip({ status: from }));

        await expect(
          service.changeStatus(TRIP_ID, { status: to }),
        ).rejects.toThrow();
        expect(eventBus.publish).not.toHaveBeenCalled();
      },
    );

    it("emits nothing when the Trip does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED }),
      ).rejects.toThrow();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it("emits nothing when the database update fails", async () => {
      (repository.runInTransaction as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("write failed", {
          code: "P2025",
          clientVersion: "7.0.0",
        }),
      );

      await expect(
        service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED }),
      ).rejects.toThrow();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });

  /**
   * A subscriber reads the Trip for itself. Published inside the transaction it
   * would still see the previous status, or price a Trip whose commit then
   * failed.
   */
  describe("when the event is emitted relative to the commit", () => {
    it("publishes only after the transaction has committed", async () => {
      await service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED });

      expect(journal).toEqual(["commit", "publish"]);
    });

    it("keeps pricing out of the status transaction", async () => {
      let publishedInsideTransaction = false;
      (repository.runInTransaction as jest.Mock).mockImplementation(
        async (work: (repo: TripRepository) => Promise<unknown>) => {
          const result = await work(repository);
          publishedInsideTransaction = eventBus.publish.mock.calls.length > 0;
          return result;
        },
      );

      await service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED });

      expect(publishedInsideTransaction).toBe(false);
    });

    it("still returns the changed Trip when a subscriber is slow", async () => {
      eventBus.publish.mockImplementation(
        () => new Promise((resolve) => setImmediate(resolve)),
      );

      const result = await service.changeStatus(TRIP_ID, {
        status: TripStatus.CLOSED,
      });

      expect(result.status).toBe(TripStatus.CLOSED);
    });
  });

  describe("the event payload", () => {
    it("carries the Trip's identity", () => {
      expect(new TripClosedEvent(TRIP_ID).tripId).toBe(TRIP_ID);
    });

    it("is named as a fact that happened, not as an instruction", () => {
      expect(new TripClosedEvent(TRIP_ID).eventName).toBe(TRIP_CLOSED_EVENT);
      expect(TRIP_CLOSED_EVENT).toBe("trip.closed");
    });

    it("carries nothing but the identity", async () => {
      await service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED });

      const [published] = eventBus.publish.mock.calls[0];

      expect(Object.keys(published).sort()).toEqual(["eventName", "tripId"]);
    });

    it("carries no Prisma entity, no pricing result and no money", async () => {
      await service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED });

      const serialised = JSON.stringify(eventBus.publish.mock.calls[0][0]);

      expect(serialised).not.toContain("bookingNumber");
      expect(serialised).not.toContain("totalPrice");
      expect(serialised).not.toMatch(/\d+\.\d{2}/);
    });
  });

  /**
   * The dependency the architecture forbids is TripService -> Pricing Engine.
   * Asserted against the source, because a compile-time import is exactly the
   * thing that must never appear.
   */
  describe("dependency direction", () => {
    const tripsDirectory = join(__dirname);

    function sourceOf(fileName: string): string {
      return readFileSync(join(tripsDirectory, fileName), "utf8");
    }

    it.each(["trip.service.ts", "trip.module.ts", "trip.controller.ts"])(
      "%s imports nothing from the Pricing Engine",
      (fileName) => {
        const source = sourceOf(fileName);

        expect(source).not.toContain("pricing-engine");
        expect(source).not.toContain("PricingEngineService");
        expect(source).not.toContain("PricingEngineModule");
      },
    );

    it("the Trip module imports no pricing module at all", () => {
      const source = sourceOf("trip.module.ts");

      expect(source).not.toContain("trip-pricing");
      expect(source).not.toContain("pricing-reprocess");
    });

    it("TripService reaches the outside world only through the event bus", () => {
      const source = sourceOf("trip.service.ts");

      expect(source).toContain("DomainEventBus");
      expect(source).toContain("TripClosedEvent");
    });

    it("the event contract itself depends on nothing but the bus", () => {
      // Imports only: the prose explains why pricing is a subscriber's
      // concern, which is not the same as depending on it.
      const imports = sourceOf(join("events", "trip-closed.event.ts"))
        .split("\n")
        .filter((line) => line.startsWith("import "));

      expect(imports).toEqual([
        'import { DomainEvent } from "../../common/events/domain-event-bus";',
      ]);
    });
  });
});
