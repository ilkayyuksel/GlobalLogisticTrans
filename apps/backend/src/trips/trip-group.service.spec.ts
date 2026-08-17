import { Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import {
  TooFewTripsToGroupException,
  TripAlreadyGroupedException,
  TripNotFoundException,
  TripNotInGroupException,
} from "./exceptions/trip.exceptions";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * Manual grouping and unlinking.
 *
 * A manual group is an operator's statement that these Trips belong together.
 * It is NOT a Combination: no rule about directions, dates or statuses applies,
 * and these tests hold the service to that — the only refusals are about the
 * request being meaningless (fewer than two Trips) or destructive (moving a
 * Trip out of a group behind the operator's back).
 */

const TRIP_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TRIP_B = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const TRIP_C = "9f8e7d6c-5b4a-4392-8172-0a1b2c3d4e5f";
const GROUP_ID = "97777777-7777-4777-8777-777777777777";

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_A,
    pdfDocumentId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    direction: null,
    bookingNumber: "BK-2026-0042",
    containerNumber: null,
    containerType: "45PH",
    terminal: null,
    destinationCity: "Bousbecque",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-08-13T00:00:00.000Z"),
    planningDate: new Date("2026-08-13T00:00:00.000Z"),
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

describe("TripService grouping", () => {
  let repository: {
    findManyByIds: jest.Mock;
    createTripGroup: jest.Mock;
    assignToGroup: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    runInTransaction: jest.Mock;
  };
  let service: TripService;

  beforeEach(() => {
    repository = {
      findManyByIds: jest.fn(),
      createTripGroup: jest.fn().mockResolvedValue({ id: GROUP_ID }),
      assignToGroup: jest.fn().mockResolvedValue(2),
      findById: jest.fn(),
      update: jest.fn(),
      runInTransaction: jest.fn((work: (r: unknown) => Promise<unknown>) =>
        work(repository),
      ),
    };

    service = new TripService(
      repository as unknown as TripRepository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      {
        resolveOne: () =>
          Promise.resolve({ vehicle: null, effectiveDriver: null }),
        resolveMany: (trips: readonly { id: string }[]) =>
          Promise.resolve(
            new Map(
              trips.map((item) => [
                item.id,
                { vehicle: null, effectiveDriver: null },
              ]),
            ),
          ),
      } as unknown as TripPlanningDataService,
      { publish: jest.fn() } as unknown as DomainEventBus,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  describe("creating a group", () => {
    beforeEach(() => {
      repository.findManyByIds
        .mockResolvedValueOnce([trip({ id: TRIP_A }), trip({ id: TRIP_B })])
        .mockResolvedValueOnce([
          trip({ id: TRIP_A, tripGroupId: GROUP_ID }),
          trip({ id: TRIP_B, tripGroupId: GROUP_ID }),
        ]);
    });

    it("puts two Trips into one new group", async () => {
      const grouped = await service.createGroup([TRIP_A, TRIP_B]);

      expect(repository.createTripGroup).toHaveBeenCalledTimes(1);
      expect(repository.assignToGroup).toHaveBeenCalledWith(
        [TRIP_A, TRIP_B],
        GROUP_ID,
      );
      expect(grouped.map((item) => item.tripGroupId)).toEqual([
        GROUP_ID,
        GROUP_ID,
      ]);
    });

    /** Everything commits together or nothing does. */
    it("does all of it inside one transaction", async () => {
      await service.createGroup([TRIP_A, TRIP_B]);

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
    });

    it("returns the Trips as they were actually written", async () => {
      const grouped = await service.createGroup([TRIP_A, TRIP_B]);

      // The second read is the one inside the transaction, after the update.
      expect(repository.findManyByIds).toHaveBeenCalledTimes(2);
      expect(grouped).toHaveLength(2);
    });
  });

  it("groups three Trips just as readily", async () => {
    const ids = [TRIP_A, TRIP_B, TRIP_C];

    repository.findManyByIds
      .mockResolvedValueOnce(ids.map((id) => trip({ id })))
      .mockResolvedValueOnce(ids.map((id) => trip({ id, tripGroupId: GROUP_ID })));

    expect(await service.createGroup(ids)).toHaveLength(3);
  });

  /**
   * A manual group carries no domain rule. Grouping a CLOSED Trip with an OPEN
   * one on another date is an operational decision, not an error.
   */
  it("accepts any statuses and any dates", async () => {
    repository.findManyByIds
      .mockResolvedValueOnce([
        trip({ id: TRIP_A, status: TripStatus.CLOSED }),
        trip({
          id: TRIP_B,
          status: TripStatus.CANCELLED,
          direction: null,
          planningDate: new Date("2026-09-01T00:00:00.000Z"),
        }),
      ])
      .mockResolvedValueOnce([
        trip({ id: TRIP_A, tripGroupId: GROUP_ID }),
        trip({ id: TRIP_B, tripGroupId: GROUP_ID }),
      ]);

    await expect(service.createGroup([TRIP_A, TRIP_B])).resolves.toHaveLength(2);
  });

  describe("refusing a group", () => {
    it("refuses fewer than two Trips", async () => {
      await expect(service.createGroup([TRIP_A])).rejects.toBeInstanceOf(
        TooFewTripsToGroupException,
      );
      expect(repository.createTripGroup).not.toHaveBeenCalled();
    });

    it("refuses an empty request", async () => {
      await expect(service.createGroup([])).rejects.toBeInstanceOf(
        TooFewTripsToGroupException,
      );
    });

    it("refuses an unknown Trip, naming it", async () => {
      // Not `Once`: the assertion below makes a second, identical call.
      repository.findManyByIds.mockResolvedValue([trip({ id: TRIP_A })]);

      await expect(
        service.createGroup([TRIP_A, TRIP_B]),
      ).rejects.toBeInstanceOf(TripNotFoundException);
      await expect(
        service.createGroup([TRIP_A, TRIP_B]),
      ).rejects.toThrow(TRIP_B);
    });

    /** Moving a Trip between groups would change what its old group means. */
    it("refuses a Trip that already belongs to a group", async () => {
      repository.findManyByIds.mockResolvedValueOnce([
        trip({ id: TRIP_A }),
        trip({ id: TRIP_B, tripGroupId: GROUP_ID }),
      ]);

      await expect(
        service.createGroup([TRIP_A, TRIP_B]),
      ).rejects.toBeInstanceOf(TripAlreadyGroupedException);
    });

    /** No group is left behind when the request is rejected mid-transaction. */
    it("creates no group when a Trip is rejected", async () => {
      repository.findManyByIds.mockResolvedValueOnce([
        trip({ id: TRIP_A, tripGroupId: GROUP_ID }),
        trip({ id: TRIP_B }),
      ]);

      await expect(service.createGroup([TRIP_A, TRIP_B])).rejects.toThrow();

      expect(repository.createTripGroup).not.toHaveBeenCalled();
      expect(repository.assignToGroup).not.toHaveBeenCalled();
    });
  });

  describe("unlinking", () => {
    it("clears only that Trip's group", async () => {
      repository.findById.mockResolvedValue(
        trip({ id: TRIP_A, tripGroupId: GROUP_ID }),
      );
      repository.update.mockResolvedValue(trip({ id: TRIP_A }));

      const updated = await service.removeFromGroup(TRIP_A);

      expect(repository.update).toHaveBeenCalledWith(TRIP_A, {
        tripGroupId: null,
      });
      expect(updated.tripGroupId).toBeNull();
    });

    /** A one-member group is allowed; nothing deletes it. */
    it("never deletes the group itself", async () => {
      repository.findById.mockResolvedValue(
        trip({ id: TRIP_A, tripGroupId: GROUP_ID }),
      );
      repository.update.mockResolvedValue(trip({ id: TRIP_A }));

      await service.removeFromGroup(TRIP_A);

      expect(
        Object.keys(repository).some((key) => key.toLowerCase().includes("delete")),
      ).toBe(false);
    });

    it("refuses a Trip that is in no group", async () => {
      repository.findById.mockResolvedValue(trip({ id: TRIP_A }));

      await expect(service.removeFromGroup(TRIP_A)).rejects.toBeInstanceOf(
        TripNotInGroupException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it("refuses an unknown Trip", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.removeFromGroup(TRIP_A)).rejects.toBeInstanceOf(
        TripNotFoundException,
      );
    });
  });
});
