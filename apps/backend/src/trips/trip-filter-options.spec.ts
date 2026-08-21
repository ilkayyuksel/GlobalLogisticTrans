import { Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * The two things the Ritten filters need from the backend: which terminals
 * actually exist, and Trips carrying a given Custom Property.
 *
 * Both are answered by the database over the WHOLE result set. A filter that
 * narrowed only the loaded page would look right and be wrong past the first
 * fifty rows, and a terminal dropdown built from one page would be missing
 * values that exist.
 */
describe("Trip filter options", () => {
  let repository: {
    findPage: jest.Mock;
    findDistinctTerminals: jest.Mock;
    findCustomPropertiesForTrips: jest.Mock;
  };
  let service: TripService;

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findDistinctTerminals: jest.fn().mockResolvedValue([]),
      findCustomPropertiesForTrips: jest.fn().mockResolvedValue([]),
    };

    service = new TripService(
      repository as unknown as TripRepository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      {
        resolveOne: () =>
          Promise.resolve({
            vehicle: null,
            effectiveDriver: null,
            latestUpdate: null,
            costConfirmation: null,
            customProperties: [],
          }),
        resolveMany: (trips: readonly Trip[]) =>
          Promise.resolve(
            new Map(
              trips.map((trip) => [
                trip.id,
                {
                  vehicle: null,
                  effectiveDriver: null,
                  latestUpdate: null,
                  costConfirmation: null,
                  customProperties: [],
                },
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

  describe("the terminals a filter may offer", () => {
    it("returns what the Trips actually carry", async () => {
      repository.findDistinctTerminals.mockResolvedValue([
        "PSA Quay 869",
        "Quay 869",
      ]);

      expect(await service.findTerminals()).toEqual([
        "PSA Quay 869",
        "Quay 869",
      ]);
    });

    /** A filter must not offer a value that returns nothing in the list. */
    it("excludes the statuses the list hides", async () => {
      await service.findTerminals();

      expect(repository.findDistinctTerminals).toHaveBeenCalledWith([
        TripStatus.DELETED,
      ]);
    });

    it("has nothing to offer when no Trip names a terminal", async () => {
      expect(await service.findTerminals()).toEqual([]);
    });
  });

  /**
   * The sort travels to the DATABASE, never to a page of already-fetched rows.
   * Sorting in the browser would order only the page in view and silently
   * misrepresent every other page of the period.
   */
  describe("sorting", () => {
    it("passes the chosen time and direction through", async () => {
      await service.findAll({
        page: 1,
        pageSize: 25,
        sortBy: "endTime",
        sortDirection: "desc",
      });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: { field: "endTime", direction: "desc" },
        }),
      );
    });

    it("defaults the direction to ascending", async () => {
      await service.findAll({ page: 1, pageSize: 25, sortBy: "startTime" });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: { field: "startTime", direction: "asc" },
        }),
      );
    });

    /** No sort asked for means the repository's own default order. */
    it("asks for no sort when none was chosen", async () => {
      await service.findAll({ page: 1, pageSize: 25 });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ sort: undefined }),
      );
    });

    it("survives alongside the period and the filters", async () => {
      await service.findAll({
        page: 1,
        pageSize: 25,
        sortBy: "startTime",
        sortDirection: "desc",
        planningDateFrom: "2026-08-10",
        planningDateTo: "2026-08-16",
        vehicleId: "25fed53c-1399-4b99-b667-2f7e508eda88",
      });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: { field: "startTime", direction: "desc" },
          planningDateFrom: new Date("2026-08-10T00:00:00.000Z"),
          planningDateTo: new Date("2026-08-16T00:00:00.000Z"),
          vehicleId: "25fed53c-1399-4b99-b667-2f7e508eda88",
        }),
      );
    });
  });

  describe("filtering by Custom Property", () => {
    it("passes the property through to the database", async () => {
      await service.findAll({
        page: 1,
        pageSize: 25,
        customPropertyId: "b36469b0-37ec-40ba-81da-9bc272e05d60",
      });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          customPropertyId: "b36469b0-37ec-40ba-81da-9bc272e05d60",
        }),
      );
    });

    /** The filter must survive alongside the period, status and search. */
    it("combines with the period, the status and the search", async () => {
      await service.findAll({
        page: 2,
        pageSize: 50,
        customPropertyId: "b36469b0-37ec-40ba-81da-9bc272e05d60",
        planningDateFrom: "2026-08-10",
        planningDateTo: "2026-08-16",
        status: TripStatus.OPEN,
        search: "psa",
      });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          customPropertyId: "b36469b0-37ec-40ba-81da-9bc272e05d60",
          planningDateFrom: new Date("2026-08-10T00:00:00.000Z"),
          planningDateTo: new Date("2026-08-16T00:00:00.000Z"),
          status: TripStatus.OPEN,
          search: "psa",
          skip: 50,
          take: 50,
        }),
      );
    });

    it("does not filter when none is asked for", async () => {
      await service.findAll({ page: 1, pageSize: 25 });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ customPropertyId: undefined }),
      );
    });
  });
});
