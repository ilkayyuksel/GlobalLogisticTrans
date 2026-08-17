import { TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { TripCustomPropertyService } from "../trip-custom-properties/trip-custom-property.service";
import { TripResponseDto } from "../trips/dto/trip-response.dto";
import {
  MissingRoutePricingException,
  MissingTripPricingInputException,
} from "./exceptions/pricing-engine.exceptions";
import { PricingRuleConfiguration } from "./pricing-calculation-context";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingStrategy } from "./pricing-settings";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ROUTE_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

function buildTrip(overrides: Partial<TripResponseDto> = {}): TripResponseDto {
  return {
    id: TRIP_ID,
    pdfDocumentId: "pdf-1",
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
  customProperties: [],
    status: TripStatus.CLOSED,
    direction: null,
    bookingNumber: "BK-2026-0042",
    containerNumber: null,
    containerType: "45PH",
    terminal: "Antwerp",
    destinationCity: "Rotterdam",
    destinationCountry: "Netherlands",
    originalPlanningDate: "2026-08-17",
    planningDate: "2026-08-17",
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
  vehicle: null,
  effectiveDriver: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

function buildRules(
  overrides: Partial<PricingRuleConfiguration> = {},
): PricingRuleConfiguration {
  return {
    strategy: PricingStrategy.ROUTE_BASED,
    fuelPercentage: "15",
    combinationSurcharge: "75",
    waitingTimeFreeMinutes: 60,
    waitingTimeBlockMinutes: 30,
    waitingTimeBlockPrice: "25.00",
    ruleVersion: "2026.1",
    ...overrides,
  };
}

const ROUTE_PRICING = {
  id: ROUTE_ID,
  routeName: "Antwerp - Rotterdam",
  departure: "Antwerp",
  destination: "Rotterdam",
  basePrice: "380.00",
  notes: null,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

/** One assignment, shaped as TripCustomPropertyService returns it. */
function assignment(
  id: string,
  name: string,
  pricingComponentId: string | null,
  defaultPrice: string | null,
  isActive = true,
) {
  return {
    id: `assignment-${id}`,
    tripId: TRIP_ID,
    customPropertyId: id,
    customProperty: {
      id,
      name,
      description: null,
      pricingComponentId,
      defaultPrice,
      displayOrder: 1,
      color: null,
      isActive,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    assignedAt: new Date("2026-08-01T00:00:00Z"),
  };
}

describe("PricingComponentResolver", () => {
  let routePricingService: { findActiveRoute: jest.Mock };
  let tripCustomPropertyService: { findByTripId: jest.Mock };
  let ruleResolver: { resolveDistanceRatePerKm: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let resolver: PricingComponentResolver;

  beforeEach(() => {
    routePricingService = {
      findActiveRoute: jest.fn().mockResolvedValue(ROUTE_PRICING),
    };
    tripCustomPropertyService = {
      findByTripId: jest.fn().mockResolvedValue({ items: [] }),
    };
    ruleResolver = {
      resolveDistanceRatePerKm: jest.fn().mockResolvedValue("1.85"),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    resolver = new PricingComponentResolver(
      routePricingService as unknown as RoutePricingService,
      tripCustomPropertyService as unknown as TripCustomPropertyService,
      ruleResolver as unknown as PricingRuleResolver,
      logger as unknown as AppLoggerService,
    );
  });

  describe("route-based base source", () => {
    it("looks the route up by terminal and destination city", async () => {
      await resolver.resolveBaseSource(buildTrip(), buildRules());

      expect(routePricingService.findActiveRoute).toHaveBeenCalledWith(
        "Antwerp",
        "Rotterdam",
      );
    });

    it("returns the configured base price as an exact string", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip(),
        buildRules(),
      );

      expect(source).toEqual({
        strategy: PricingStrategy.ROUTE_BASED,
        routePricingId: ROUTE_ID,
        basePrice: "380.00",
      });
    });

    it("carries no route, which belongs to the Trip rather than the strategy", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip(),
        buildRules(),
      );

      expect(source).not.toHaveProperty("departure");
      expect(source).not.toHaveProperty("destination");
    });

    it("fails when no active route pricing is configured", async () => {
      routePricingService.findActiveRoute.mockResolvedValue(null);

      await expect(
        resolver.resolveBaseSource(buildTrip(), buildRules()),
      ).rejects.toBeInstanceOf(MissingRoutePricingException);
    });

    it("fails when the Trip has no terminal to price from", async () => {
      await expect(
        resolver.resolveBaseSource(buildTrip({ terminal: null }), buildRules()),
      ).rejects.toBeInstanceOf(MissingTripPricingInputException);
      expect(routePricingService.findActiveRoute).not.toHaveBeenCalled();
    });

    it("never reads the distance rate", async () => {
      await resolver.resolveBaseSource(buildTrip(), buildRules());

      expect(ruleResolver.resolveDistanceRatePerKm).not.toHaveBeenCalled();
    });
  });

  describe("distance-based base source", () => {
    const distanceRules = buildRules({
      strategy: PricingStrategy.DISTANCE_BASED,
    });

    it("returns the Trip distance and the configured rate, unmultiplied", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip({ distanceKm: "132.50" }),
        distanceRules,
      );

      // 132.50 x 1.85 is the calculation phase's job, not this resolver's.
      expect(source).toEqual({
        strategy: PricingStrategy.DISTANCE_BASED,
        distanceKm: "132.50",
        ratePerKm: "1.85",
      });
    });

    it("fails when the Trip has no distance", async () => {
      await expect(
        resolver.resolveBaseSource(buildTrip(), distanceRules),
      ).rejects.toBeInstanceOf(MissingTripPricingInputException);
    });

    it("accepts a zero distance, which is a value rather than an absence", async () => {
      const source = await resolver.resolveBaseSource(
        buildTrip({ distanceKm: "0.00" }),
        distanceRules,
      );

      expect(source).toMatchObject({ distanceKm: "0.00" });
    });

    it("never reads route pricing", async () => {
      await resolver.resolveBaseSource(
        buildTrip({ distanceKm: "10.00" }),
        distanceRules,
      );

      expect(routePricingService.findActiveRoute).not.toHaveBeenCalled();
    });

    it("propagates a missing distance-rate setting", async () => {
      const failure = new Error("missing rate");
      ruleResolver.resolveDistanceRatePerKm.mockRejectedValue(failure);

      await expect(
        resolver.resolveBaseSource(
          buildTrip({ distanceKm: "10.00" }),
          distanceRules,
        ),
      ).rejects.toBe(failure);
    });
  });

  /**
   * The Engine prices what a Trip CARRIES, not what the catalog offers. Reading
   * the catalog would have charged every Trip for every configured property.
   */
  describe("assigned custom properties", () => {
    it("asks for this Trip's assignments", async () => {
      await resolver.resolveAssignedCustomProperties(TRIP_ID);

      expect(tripCustomPropertyService.findByTripId).toHaveBeenCalledWith(
        TRIP_ID,
      );
    });

    it("returns an empty list for a Trip that carries none", async () => {
      expect(await resolver.resolveAssignedCustomProperties(TRIP_ID)).toEqual(
        [],
      );
    });

    it("carries everything a later calculator needs, so it never looks anything up", async () => {
      tripCustomPropertyService.findByTripId.mockResolvedValue({
        items: [
          assignment("property-1", "TAR", null, "35.00"),
          assignment("property-2", "Toll", "component-toll", null),
        ],
      });

      expect(await resolver.resolveAssignedCustomProperties(TRIP_ID)).toEqual([
        {
          customPropertyId: "property-1",
          name: "TAR",
          pricingComponentId: null,
          defaultPrice: "35.00",
        },
        {
          customPropertyId: "property-2",
          name: "Toll",
          pricingComponentId: "component-toll",
          defaultPrice: null,
        },
      ]);
    });

    it("keeps a property that has since been deactivated", async () => {
      // The Trip carries it. Withdrawing a property from the catalog must not
      // silently change what an already-planned Trip is charged.
      tripCustomPropertyService.findByTripId.mockResolvedValue({
        items: [assignment("property-1", "TAR", null, "35.00", false)],
      });

      const resolved = await resolver.resolveAssignedCustomProperties(TRIP_ID);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].customPropertyId).toBe("property-1");
    });

    it("preserves the order the service returned", async () => {
      tripCustomPropertyService.findByTripId.mockResolvedValue({
        items: [
          assignment("property-2", "Second", null, null),
          assignment("property-1", "First", null, null),
        ],
      });

      const resolved = await resolver.resolveAssignedCustomProperties(TRIP_ID);

      expect(resolved.map((property) => property.customPropertyId)).toEqual([
        "property-2",
        "property-1",
      ]);
    });

    it("never reads the catalog", async () => {
      await resolver.resolveAssignedCustomProperties(TRIP_ID);

      const source = PricingComponentResolver.prototype.constructor.toString();

      expect(source).not.toContain("customPropertyService");
      expect(source).not.toContain("findAll");
    });

    it("logs a count only, never a property name or price", async () => {
      tripCustomPropertyService.findByTripId.mockResolvedValue({
        items: [assignment("property-1", "TAR", null, "35.00")],
      });

      await resolver.resolveAssignedCustomProperties(TRIP_ID);

      const logged = JSON.stringify(logger.log.mock.calls);

      expect(logged).not.toContain("TAR");
      expect(logged).not.toContain("35.00");
    });
  });

  it("never logs a price", async () => {
    routePricingService.findActiveRoute.mockResolvedValue(null);

    await expect(
      resolver.resolveBaseSource(buildTrip(), buildRules()),
    ).rejects.toBeInstanceOf(MissingRoutePricingException);

    const logged = JSON.stringify([
      ...logger.warn.mock.calls,
      ...logger.log.mock.calls,
    ]);

    expect(logged).not.toContain("380");
  });
});
