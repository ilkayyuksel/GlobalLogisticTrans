import { NotFoundException } from "@nestjs/common";
import { CustomProperty, Prisma } from "@prisma/client";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripService } from "../trips/trip.service";
import {
  DuplicateTripCustomPropertyException,
  InactiveCustomPropertyException,
  TripCustomPropertyNotFoundException,
} from "./exceptions/trip-custom-property.exceptions";
import {
  TripCustomPropertyRepository,
  TripCustomPropertyWithProperty,
} from "./trip-custom-property.repository";
import { TripCustomPropertyService } from "./trip-custom-property.service";

const ASSIGNMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ASSIGNMENT_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const TRIP_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PROPERTY_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function buildProperty(overrides: Partial<CustomProperty> = {}): CustomProperty {
  return {
    id: PROPERTY_ID,
    name: "TAR",
    description: null,
    pricingComponentId: null,
    defaultPrice: new Prisma.Decimal("35.00"),
    displayOrder: 1,
    color: "#f59e0b",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildAssignment(
  overrides: Partial<TripCustomPropertyWithProperty> = {},
): TripCustomPropertyWithProperty {
  return {
    id: ASSIGNMENT_ID,
    tripId: TRIP_ID,
    customPropertyId: PROPERTY_ID,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    customProperty: buildProperty(),
    ...overrides,
  };
}

describe("TripCustomPropertyService", () => {
  let repository: jest.Mocked<TripCustomPropertyRepository>;
  let tripService: { findById: jest.Mock };
  let customPropertyService: { findById: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: TripCustomPropertyService;

  beforeEach(() => {
    repository = {
      findByTripId: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      findByTripAndProperty: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildAssignment()),
      delete: jest.fn().mockResolvedValue(buildAssignment()),
    } as unknown as jest.Mocked<TripCustomPropertyRepository>;

    tripService = { findById: jest.fn().mockResolvedValue({ id: TRIP_ID }) };
    customPropertyService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: PROPERTY_ID, isActive: true }),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new TripCustomPropertyService(
      repository,
      tripService as unknown as TripService,
      customPropertyService as unknown as CustomPropertyService,
      logger as unknown as AppLoggerService,
    );
  });

  describe("findByTripId", () => {
    it("returns the Trip's assignments", async () => {
      repository.findByTripId.mockResolvedValue([buildAssignment()]);

      const result = await service.findByTripId(TRIP_ID);

      expect(repository.findByTripId).toHaveBeenCalledWith(TRIP_ID);
      expect(result.items).toHaveLength(1);
    });

    it("returns an empty list when the Trip carries none", async () => {
      expect((await service.findByTripId(TRIP_ID)).items).toEqual([]);
    });

    it("propagates the Trip's 404 rather than reporting no properties", async () => {
      tripService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.findByTripId(TRIP_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.findByTripId).not.toHaveBeenCalled();
    });

    it("returns properties that have since been deactivated", async () => {
      // A Trip keeps what it was assigned; deactivation only blocks new ones.
      repository.findByTripId.mockResolvedValue([
        buildAssignment({ customProperty: buildProperty({ isActive: false }) }),
      ]);

      const { items } = await service.findByTripId(TRIP_ID);

      expect(items[0].customProperty.isActive).toBe(false);
    });
  });

  describe("assign", () => {
    const dto = { tripId: TRIP_ID, customPropertyId: PROPERTY_ID };

    it("creates the assignment with the two identifiers", async () => {
      await service.assign(dto);

      expect(repository.create).toHaveBeenCalledWith({
        tripId: TRIP_ID,
        customPropertyId: PROPERTY_ID,
      });
    });

    it("returns the assignment with the property as configured now", async () => {
      const result = await service.assign(dto);

      expect(result.customPropertyId).toBe(PROPERTY_ID);
      expect(result.customProperty.name).toBe("TAR");
      expect(result.customProperty.defaultPrice).toBe("35.00");
      expect(result.assignedAt).toEqual(new Date("2026-08-01T00:00:00Z"));
    });

    it("propagates the Trip's 404 when the Trip does not exist", async () => {
      tripService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.assign(dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("propagates the property's 404 when the property does not exist", async () => {
      customPropertyService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.assign(dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("rejects an inactive property", async () => {
      customPropertyService.findById.mockResolvedValue({
        id: PROPERTY_ID,
        isActive: false,
      });

      await expect(service.assign(dto)).rejects.toBeInstanceOf(
        InactiveCustomPropertyException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("rejects a property already assigned to that Trip", async () => {
      repository.findByTripAndProperty.mockResolvedValue(
        buildAssignment({ id: OTHER_ASSIGNMENT_ID }),
      );

      await expect(service.assign(dto)).rejects.toBeInstanceOf(
        DuplicateTripCustomPropertyException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("scopes the duplicate check to this Trip and this property", async () => {
      await service.assign(dto);

      expect(repository.findByTripAndProperty).toHaveBeenCalledWith(
        TRIP_ID,
        PROPERTY_ID,
      );
    });

    it("translates the unique-index violation that wins a concurrent race", async () => {
      // The pre-check cannot be atomic; the index is the real guard.
      repository.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.0.0",
        }),
      );

      await expect(service.assign(dto)).rejects.toBeInstanceOf(
        DuplicateTripCustomPropertyException,
      );
    });

    it("rethrows any other Prisma error untouched", async () => {
      const failure = new Prisma.PrismaClientKnownRequestError(
        "Foreign key constraint failed",
        { code: "P2003", clientVersion: "7.0.0" },
      );
      repository.create.mockRejectedValue(failure);

      await expect(service.assign(dto)).rejects.toBe(failure);
    });

    it("validates the Trip before the property, and both before writing", async () => {
      const order: string[] = [];
      tripService.findById.mockImplementation(async () => {
        order.push("trip");
        return { id: TRIP_ID };
      });
      customPropertyService.findById.mockImplementation(async () => {
        order.push("property");
        return { id: PROPERTY_ID, isActive: true };
      });
      repository.create.mockImplementation(async () => {
        order.push("create");
        return buildAssignment();
      });

      await service.assign(dto);

      expect(order).toEqual(["trip", "property", "create"]);
    });

    it("logs identifiers only, never the property name or price", async () => {
      await service.assign(dto);

      expect(logger.log).toHaveBeenCalledWith(
        "Custom property assigned to Trip",
        {
          tripCustomPropertyId: ASSIGNMENT_ID,
          tripId: TRIP_ID,
          customPropertyId: PROPERTY_ID,
        },
      );

      const logged = JSON.stringify(logger.log.mock.calls);

      expect(logged).not.toContain("TAR");
      expect(logged).not.toContain("35.00");
    });
  });

  describe("remove", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildAssignment());
    });

    it("deletes the assignment and returns what was removed", async () => {
      const result = await service.remove(ASSIGNMENT_ID);

      expect(repository.delete).toHaveBeenCalledWith(ASSIGNMENT_ID);
      expect(result.id).toBe(ASSIGNMENT_ID);
    });

    it("throws when the assignment does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.remove(ASSIGNMENT_ID)).rejects.toBeInstanceOf(
        TripCustomPropertyNotFoundException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("never consults the Trip or the property, which are not modified", async () => {
      await service.remove(ASSIGNMENT_ID);

      expect(tripService.findById).not.toHaveBeenCalled();
      expect(customPropertyService.findById).not.toHaveBeenCalled();
    });

    it("removes an assignment whose property is now inactive", async () => {
      repository.findById.mockResolvedValue(
        buildAssignment({ customProperty: buildProperty({ isActive: false }) }),
      );

      await service.remove(ASSIGNMENT_ID);

      expect(repository.delete).toHaveBeenCalled();
    });

    it("logs identifiers only", async () => {
      await service.remove(ASSIGNMENT_ID);

      expect(logger.log).toHaveBeenCalledWith(
        "Custom property removed from Trip",
        {
          tripCustomPropertyId: ASSIGNMENT_ID,
          tripId: TRIP_ID,
          customPropertyId: PROPERTY_ID,
        },
      );
    });
  });

  it("never prices, never touches a snapshot and never touches Trip status", () => {
    const source = TripCustomPropertyService.prototype.constructor.toString();

    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("tripPricing");
    expect(source).not.toContain("changeStatus");
    expect(source).not.toContain("defaultPrice");
  });
});
