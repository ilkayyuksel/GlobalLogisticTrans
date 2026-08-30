import { CustomProperty, Prisma, TripStatus } from "@prisma/client";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { PricingEngineErrorCode } from "../pricing-engine/exceptions/pricing-engine.exceptions";
import { toEffectivePricingDto } from "../trip-pricing/dto/effective-pricing.dto";
import { resolveEffectivePricing } from "../trip-pricing/effective-pricing";
import { TripService } from "../trips/trip.service";
import { TripCustomPropertyService } from "./trip-custom-property.service";
import {
  TripCustomPropertyRepository,
  TripCustomPropertyWithProperty,
} from "./trip-custom-property.repository";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PROPERTY_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const ASSIGNMENT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

/**
 * Assigning or removing a Custom Property reprices the Trip.
 *
 * ── WHAT THIS SUITE IS ABOUT ────────────────────────────────────────────────
 * Not what a property is worth — that is the Engine's, and it is asserted where
 * the arithmetic lives. This is about the SEQUENCE and the CONTRACT:
 *
 *   the row is written FIRST, so the recalculation reads the state the operator
 *     just created rather than the one it replaced;
 *   the recalculation is AWAITED, never fire-and-forget: a response that
 *     overtook the Engine would carry the figures from before the change;
 *   the response carries the complete current pricing;
 *   a recalculation that fails does NOT undo the write, does not return the
 *     previous figures, and names its reason;
 *   ONE recalculation per mutation, whatever the Trip carries;
 *   and the Trip's status is never touched.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildProperty(overrides: Partial<CustomProperty> = {}): CustomProperty {
  return {
    id: PROPERTY_ID,
    name: "ADR toeslag",
    description: null,
    pricingComponentId: null,
    defaultPrice: new Prisma.Decimal("80.00"),
    displayOrder: 2,
    color: null,
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
    isAutomatic: false,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    customProperty: buildProperty(),
    ...overrides,
  };
}

/** A breakdown as the shared effective read produces one. */
function pricingWithOthers(others: string) {
  return toEffectivePricingDto(
    resolveEffectivePricing(
      [
        {
          componentCode: "BASE_PRICE",
          amount: new Prisma.Decimal("520.00"),
          customPropertyId: null,
          description: "Base",
        },
        {
          componentCode: "CUSTOM_PROPERTY",
          amount: new Prisma.Decimal(others),
          customPropertyId: PROPERTY_ID,
          description: "Property",
        },
      ],
      [],
    ),
  );
}

describe("a Custom Property change reprices the Trip", () => {
  let repository: jest.Mocked<TripCustomPropertyRepository>;
  let tripService: { findById: jest.Mock };
  let customPropertyService: { findById: jest.Mock };
  let recalculation: ReturnType<typeof stubPricingRecalculation>;
  let service: TripCustomPropertyService;

  /** Rebuilds the service around a specific recalculation outcome. */
  function serviceAnswering(
    outcome: Parameters<typeof stubPricingRecalculation>[0],
  ): TripCustomPropertyService {
    recalculation = stubPricingRecalculation(outcome);

    return new TripCustomPropertyService(
      repository,
      tripService as unknown as TripService,
      customPropertyService as unknown as CustomPropertyService,
      recalculation,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  }

  beforeEach(() => {
    repository = {
      findByTripId: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(buildAssignment()),
      findByTripAndProperty: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildAssignment()),
      delete: jest.fn().mockResolvedValue(buildAssignment()),
    } as unknown as jest.Mocked<TripCustomPropertyRepository>;

    // A 45PH: no container type here requires a property, which keeps these
    // tests about repricing rather than about the Flat rule.
    tripService = {
      findById: jest.fn().mockResolvedValue({
        id: TRIP_ID,
        containerType: "45PH",
        status: TripStatus.CLOSED,
      }),
    };
    customPropertyService = {
      findById: jest.fn().mockResolvedValue(buildProperty()),
    };

    service = serviceAnswering({
      pricing: pricingWithOthers("130.00"),
      reasonCode: null,
    });
  });

  describe("assigning", () => {
    it("writes the assignment before it asks for a price", async () => {
      const order: string[] = [];

      repository.create.mockImplementation(async () => {
        order.push("write");

        return buildAssignment();
      });
      recalculation.recalculate.mockImplementation(async () => {
        order.push("recalculate");

        return { pricing: null, reasonCode: null };
      });

      await service.assign({ tripId: TRIP_ID, customPropertyId: PROPERTY_ID });

      expect(order).toEqual(["write", "recalculate"]);
    });

    it("reprices exactly the Trip that changed", async () => {
      await service.assign({ tripId: TRIP_ID, customPropertyId: PROPERTY_ID });

      expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
      expect(recalculation.recalculate).toHaveBeenCalledWith(TRIP_ID);
    });

    /*
     * AWAITED, not fire-and-forget. A response that resolved before the Engine
     * finished would carry the figures from before the change, and no screen
     * could tell those from current ones.
     */
    it("waits for the recalculation before it answers", async () => {
      let hasFinished = false;

      // Resolves on a later turn of the event loop, so a caller that did NOT
      // await it would answer while this flag is still false.
      recalculation.recalculate.mockImplementation(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        hasFinished = true;

        return { pricing: pricingWithOthers("130.00"), reasonCode: null };
      });

      const result = await service.assign({
        tripId: TRIP_ID,
        customPropertyId: PROPERTY_ID,
      });

      expect(hasFinished).toBe(true);
      expect(result.pricing?.others).toBe("130.00");
    });

    it("answers with the assignment AND the current pricing", async () => {
      const result = await service.assign({
        tripId: TRIP_ID,
        customPropertyId: PROPERTY_ID,
      });

      expect(result.id).toBe(ASSIGNMENT_ID);
      expect(result.customPropertyId).toBe(PROPERTY_ID);
      expect(result.pricing?.others).toBe("130.00");
      expect(result.pricing?.totaal).toBe("650.00");
      expect(result.reasonCode).toBeNull();
    });
  });

  describe("removing", () => {
    it("deletes the assignment before it asks for a price", async () => {
      const order: string[] = [];

      repository.delete.mockImplementation(async () => {
        order.push("delete");

        return buildAssignment();
      });
      recalculation.recalculate.mockImplementation(async () => {
        order.push("recalculate");

        return { pricing: null, reasonCode: null };
      });

      await service.remove(ASSIGNMENT_ID);

      expect(order).toEqual(["delete", "recalculate"]);
    });

    it("answers with the removed assignment AND the current pricing", async () => {
      service = serviceAnswering({
        pricing: pricingWithOthers("50.00"),
        reasonCode: null,
      });

      const result = await service.remove(ASSIGNMENT_ID);

      expect(result.id).toBe(ASSIGNMENT_ID);
      expect(result.pricing?.others).toBe("50.00");
      expect(result.pricing?.totaal).toBe("570.00");
    });

    it("reprices exactly once", async () => {
      await service.remove(ASSIGNMENT_ID);

      expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
      expect(recalculation.recalculate).toHaveBeenCalledWith(TRIP_ID);
    });
  });

  /**
   * ── THE FAILURE CONTRACT ──────────────────────────────────────────────────
   * A route with no configured price is the ORDINARY state on this data, not an
   * edge case. Refusing the operator's edit until an administrator configures
   * one would block the work rather than the price.
   */
  describe("when the Trip cannot be priced", () => {
    beforeEach(() => {
      service = serviceAnswering({
        pricing: null,
        reasonCode: PricingEngineErrorCode.MISSING_ROUTE_PRICING,
      });
    });

    it("keeps the write and answers successfully", async () => {
      const result = await service.assign({
        tripId: TRIP_ID,
        customPropertyId: PROPERTY_ID,
      });

      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(ASSIGNMENT_ID);
    });

    it("returns no pricing and says why", async () => {
      const result = await service.assign({
        tripId: TRIP_ID,
        customPropertyId: PROPERTY_ID,
      });

      expect(result.pricing).toBeNull();
      expect(result.reasonCode).toBe(
        PricingEngineErrorCode.MISSING_ROUTE_PRICING,
      );
    });

    it("keeps the removal too", async () => {
      const result = await service.remove(ASSIGNMENT_ID);

      expect(repository.delete).toHaveBeenCalledWith(ASSIGNMENT_ID);
      expect(result.pricing).toBeNull();
      expect(result.reasonCode).toBe(
        PricingEngineErrorCode.MISSING_ROUTE_PRICING,
      );
    });
  });

  /**
   * CLOSED is terminal. The price of a finished job may change; the fact that
   * it is finished may not, and there is no CLOSED -> OPEN in this system.
   */
  it("never changes the Trip's status", async () => {
    await service.assign({ tripId: TRIP_ID, customPropertyId: PROPERTY_ID });
    await service.remove(ASSIGNMENT_ID);

    expect(tripService).not.toHaveProperty("changeStatus.mock.calls.length");
    expect(
      Object.keys(tripService).filter((method) => method !== "findById"),
    ).toEqual([]);
  });
});
