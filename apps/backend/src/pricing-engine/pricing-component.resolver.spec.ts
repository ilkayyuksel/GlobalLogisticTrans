import { TripStatus } from "@prisma/client";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
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
    status: TripStatus.CLOSED,
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

describe("PricingComponentResolver", () => {
  let routePricingService: { findActiveRoute: jest.Mock };
  let customPropertyService: { findAll: jest.Mock };
  let ruleResolver: { resolveDistanceRatePerKm: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let resolver: PricingComponentResolver;

  beforeEach(() => {
    routePricingService = {
      findActiveRoute: jest.fn().mockResolvedValue(ROUTE_PRICING),
    };
    customPropertyService = {
      findAll: jest.fn().mockResolvedValue({
        items: [],
        meta: { page: 1, pageSize: 200, totalItems: 0, totalPages: 0 },
      }),
    };
    ruleResolver = {
      resolveDistanceRatePerKm: jest.fn().mockResolvedValue("1.85"),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    resolver = new PricingComponentResolver(
      routePricingService as unknown as RoutePricingService,
      customPropertyService as unknown as CustomPropertyService,
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
        departure: "Antwerp",
        destination: "Rotterdam",
        basePrice: "380.00",
      });
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

  describe("active custom properties", () => {
    it("requests only active properties, one full page", async () => {
      await resolver.resolveActiveCustomProperties();

      expect(customPropertyService.findAll).toHaveBeenCalledWith({
        page: 1,
        pageSize: 200,
        isActive: true,
      });
    });

    it("maps each property to its configured price", async () => {
      customPropertyService.findAll.mockResolvedValue({
        items: [
          { id: "property-1", name: "TAR", defaultPrice: "35.00" },
          { id: "property-2", name: "Flat", defaultPrice: null },
        ],
        meta: { page: 1, pageSize: 200, totalItems: 2, totalPages: 1 },
      });

      expect(await resolver.resolveActiveCustomProperties()).toEqual([
        { customPropertyId: "property-1", name: "TAR", defaultPrice: "35.00" },
        { customPropertyId: "property-2", name: "Flat", defaultPrice: null },
      ]);
    });

    it("warns rather than silently truncating an oversized catalog", async () => {
      customPropertyService.findAll.mockResolvedValue({
        items: [{ id: "property-1", name: "TAR", defaultPrice: "35.00" }],
        meta: { page: 1, pageSize: 200, totalItems: 250, totalPages: 2 },
      });

      await resolver.resolveActiveCustomProperties();

      expect(logger.warn).toHaveBeenCalledWith(
        "Active custom property catalog exceeds one page",
        { loaded: 1, totalItems: 250 },
      );
    });

    it("does not warn when the catalog fits", async () => {
      await resolver.resolveActiveCustomProperties();

      expect(logger.warn).not.toHaveBeenCalled();
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
