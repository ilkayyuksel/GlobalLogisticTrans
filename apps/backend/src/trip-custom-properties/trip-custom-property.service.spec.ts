import { NotFoundException } from "@nestjs/common";
import { CustomProperty, Prisma } from "@prisma/client";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripService } from "../trips/trip.service";
import {
  DuplicateTripCustomPropertyException,
  InactiveCustomPropertyException,
  RequiredCustomPropertyException,
  TripCustomPropertyNotFoundException,
} from "./exceptions/trip-custom-property.exceptions";
import {
  TripCustomPropertyRepository,
  TripCustomPropertyWithProperty,
} from "./trip-custom-property.repository";
import { TripCustomPropertyService } from "./trip-custom-property.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";

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
    // Somebody chose it, which is what every assignment made through the API is.
    isAutomatic: false,
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
  let recalculation: ReturnType<typeof stubPricingRecalculation>;
  let service: TripCustomPropertyService;

  beforeEach(() => {
    repository = {
      findByTripId: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      findByTripAndProperty: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildAssignment()),
      delete: jest.fn().mockResolvedValue(buildAssignment()),
    } as unknown as jest.Mocked<TripCustomPropertyRepository>;

    // A 45PH: no container type in these tests requires a property, which is
    // what keeps them about assignment rather than about the Flat rule.
    tripService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: TRIP_ID, containerType: "45PH" }),
    };
    customPropertyService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: PROPERTY_ID, isActive: true }),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    recalculation = stubPricingRecalculation();

    service = new TripCustomPropertyService(
      repository,
      tripService as unknown as TripService,
      customPropertyService as unknown as CustomPropertyService,
      recalculation,
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
        // Chosen by a person, which is what this endpoint always means.
        isAutomatic: false,
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

    /**
     * The Trip IS read — its container type decides whether the property may
     * be unassigned at all — but neither it nor the property is written to.
     * Removing an assignment changes only the assignment.
     */
    it("reads the Trip for the rule, and modifies neither it nor the property", async () => {
      await service.remove(ASSIGNMENT_ID);

      expect(tripService.findById).toHaveBeenCalledWith(TRIP_ID);
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
  /**
   * A property the container type requires cannot be unassigned.
   *
   * The rule would put an automatic Flat straight back, so removing it would be
   * theatre; a manual Flat on a 20FL is in the same position for a better
   * reason — the invariant is about what the Trip CARRIES, not about who put it
   * there. Either way the way out is the same: change the container type.
   *
   * Enforced in the service, not only in the browser. A disabled button
   * protects nothing.
   */
  describe("a property the container type requires", () => {
    function flatOn(containerType: string, isAutomatic: boolean) {
      tripService.findById.mockResolvedValue({ id: TRIP_ID, containerType });
      repository.findById.mockResolvedValue(
        buildAssignment({
          isAutomatic,
          customProperty: buildProperty({ name: "Flat" }),
        }),
      );
    }

    it.each([
      ["20FL", true],
      ["20ST", true],
      ["20FL", false],
      ["20ST", false],
    ])(
      "refuses to remove Flat from a %s Trip (automatic: %p)",
      async (containerType, isAutomatic) => {
        flatOn(containerType, isAutomatic);

        await expect(service.remove(ASSIGNMENT_ID)).rejects.toBeInstanceOf(
          RequiredCustomPropertyException,
        );
        expect(repository.delete).not.toHaveBeenCalled();
      },
    );

    it("names the container type, which is the reason and the way out", async () => {
      flatOn("20FL", true);

      await expect(service.remove(ASSIGNMENT_ID)).rejects.toThrow(/20FL/);
    });

    it("logs the refusal without naming the property", async () => {
      flatOn("20FL", true);

      await expect(service.remove(ASSIGNMENT_ID)).rejects.toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        "Rejected removal of a required custom property",
        expect.objectContaining({ tripId: TRIP_ID }),
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("Flat");
    });

    it("allows Flat to be removed once the container type no longer requires it", async () => {
      flatOn("45PH", false);

      await expect(service.remove(ASSIGNMENT_ID)).resolves.toBeDefined();
      expect(repository.delete).toHaveBeenCalledWith(ASSIGNMENT_ID);
    });

    /** Only Flat is protected. Every other property stays freely removable. */
    it("allows another property to be removed from a 20FL Trip", async () => {
      tripService.findById.mockResolvedValue({
        id: TRIP_ID,
        containerType: "20FL",
      });
      repository.findById.mockResolvedValue(
        buildAssignment({ customProperty: buildProperty({ name: "TAR" }) }),
      );

      await expect(service.remove(ASSIGNMENT_ID)).resolves.toBeDefined();
      expect(repository.delete).toHaveBeenCalled();
    });
  });

  /**
   * The two read-only flags a client needs, and must never compute itself.
   */
  describe("what a listed assignment reports", () => {
    it("reports where the assignment came from", async () => {
      repository.findByTripId.mockResolvedValue([
        buildAssignment({ isAutomatic: true }),
      ]);

      const { items } = await service.findByTripId(TRIP_ID);

      expect(items[0].isAutomatic).toBe(true);
    });

    it("reports Flat on a 20FL Trip as required", async () => {
      tripService.findById.mockResolvedValue({
        id: TRIP_ID,
        containerType: "20FL",
      });
      repository.findByTripId.mockResolvedValue([
        buildAssignment({ customProperty: buildProperty({ name: "Flat" }) }),
      ]);

      const { items } = await service.findByTripId(TRIP_ID);

      expect(items[0].isRequired).toBe(true);
    });

    it("reports the same Flat on a 45PH Trip as not required", async () => {
      tripService.findById.mockResolvedValue({
        id: TRIP_ID,
        containerType: "45PH",
      });
      repository.findByTripId.mockResolvedValue([
        buildAssignment({ customProperty: buildProperty({ name: "Flat" }) }),
      ]);

      const { items } = await service.findByTripId(TRIP_ID);

      expect(items[0].isRequired).toBe(false);
    });

    it("reports another property on a 20FL Trip as not required", async () => {
      tripService.findById.mockResolvedValue({
        id: TRIP_ID,
        containerType: "20FL",
      });
      repository.findByTripId.mockResolvedValue([buildAssignment()]);

      const { items } = await service.findByTripId(TRIP_ID);

      expect(items[0].isRequired).toBe(false);
    });
  });
});

/**
 * ── SYSTEM-MANAGED PROPERTIES ARE NOT THE OPERATOR'S TO ASSIGN ──────────────
 * The picker does not offer them, and this is the same rule where it cannot be
 * bypassed — a stale browser tab, a script, a client written later.
 *
 * Refused on the way IN only. Nothing stored is touched, and an assignment made
 * before this rule existed can still be removed.
 */
describe("TripCustomPropertyService — manual assignment of a system property", () => {
  const TRIP_ID = "9a5e0a3f-6a1a-4e4a-9e21-6b2d4a0a1c11";

  function serviceRefusing(property: {
    name: string;
    pricingComponentId: string | null;
  }) {
    const repository = {
      findByTripId: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      findByTripAndProperty: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<TripCustomPropertyRepository>;

    const service = new TripCustomPropertyService(
      repository,
      {
        findById: jest.fn().mockResolvedValue({ id: TRIP_ID, containerType: "45PH" }),
      } as never,
      {
        findById: jest.fn().mockResolvedValue({ ...property, isActive: true }),
      } as never,
      stubPricingRecalculation() as never,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as never,
    );

    return { service, repository };
  }

  it.each([
    ["a route-priced property", { name: "Toll", pricingComponentId: "toll-component" }],
    ["the automatic property", { name: "TAR", pricingComponentId: null }],
    ["the container-type property", { name: "Flat", pricingComponentId: null }],
  ])("refuses %s", async (_label, property) => {
    const { service, repository } = serviceRefusing(property);

    await expect(
      service.assign({ tripId: TRIP_ID, customPropertyId: "property-id" }),
    ).rejects.toThrow(/managed by the system/);

    // Nothing was written.
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("says why, so an operator knows where the value comes from", async () => {
    const { service } = serviceRefusing({
      name: "Toll",
      pricingComponentId: "toll-component",
    });

    await expect(
      service.assign({ tripId: TRIP_ID, customPropertyId: "property-id" }),
    ).rejects.toThrow(/route configuration/);
  });

  /** The manual side is untouched: a genuine per-Trip property still assigns. */
  it("still assigns a genuine per-Trip property", async () => {
    const { service, repository } = serviceRefusing({
      name: "Aan/Afkoppelen",
      pricingComponentId: null,
    });

    repository.create = jest.fn().mockResolvedValue(buildAssignment());

    await expect(
      service.assign({ tripId: TRIP_ID, customPropertyId: "property-id" }),
    ).resolves.toBeDefined();
    expect(repository.create).toHaveBeenCalled();
  });
});
