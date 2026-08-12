import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { PricingCalculationStatus, TripStatus } from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  MissingPricingSettingException,
  MissingRouteCostException,
  TripNotFoundForPricingException,
  TripNotPriceableException,
} from "../pricing-engine/exceptions/pricing-engine.exceptions";
import { PricingEngineService } from "../pricing-engine/pricing-engine.service";
import { TripPricingItemService } from "../trip-pricing-items/trip-pricing-item.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { PricingReprocessController } from "./pricing-reprocess.controller";

const TRIP_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PRICING_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const ROUTE = `/api/v1/trip-pricing/trip/${TRIP_ID}/reprocess`;

const STORED_PRICING = {
  id: PRICING_ID,
  tripId: TRIP_ID,
  totalPrice: "499.50",
  currency: "EUR",
  calculatedAt: new Date("2026-08-17T09:00:01.000Z"),
  pricingEngineVersion: "1.0.0",
  pricingRuleVersion: "2026.1",
  calculationStatus: PricingCalculationStatus.CALCULATED,
  notes: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-17T09:00:01.000Z"),
};

const STORED_ITEMS = [
  {
    id: "item-1",
    tripPricingId: PRICING_ID,
    pricingComponentId: "component-base",
    customPropertyId: null,
    description: "MSC PSA European Terminal - Rotterdam",
    amount: "380.00",
    currency: "EUR",
    calculationOrder: 1,
    quantity: null,
    unitPrice: null,
    notes: null,
    createdAt: new Date("2026-08-17T09:00:01.000Z"),
    updatedAt: new Date("2026-08-17T09:00:01.000Z"),
  },
  {
    id: "item-2",
    tripPricingId: PRICING_ID,
    pricingComponentId: "component-custom",
    customPropertyId: "property-flat",
    description: "Flat",
    amount: "119.50",
    currency: "EUR",
    calculationOrder: 7,
    quantity: null,
    unitPrice: null,
    notes: null,
    createdAt: new Date("2026-08-17T09:00:01.000Z"),
    updatedAt: new Date("2026-08-17T09:00:01.000Z"),
  },
];

/**
 * Integration tests: real routing, the global ValidationPipe, the response
 * interceptor, the global exception filter and the Engine's own exception
 * filter all run. Only the three services are stubbed.
 */
describe("PricingReprocessController (integration)", () => {
  let app: INestApplication;
  let pricingEngine: { reprocess: jest.Mock };
  let tripPricingService: { findByTripId: jest.Mock };
  let tripPricingItemService: { findByTripPricingId: jest.Mock };

  beforeEach(async () => {
    pricingEngine = { reprocess: jest.fn().mockResolvedValue({}) };
    tripPricingService = {
      findByTripId: jest.fn().mockResolvedValue(STORED_PRICING),
    };
    tripPricingItemService = {
      findByTripPricingId: jest.fn().mockResolvedValue({ items: STORED_ITEMS }),
    };

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PricingReprocessController],
      providers: [
        { provide: PricingEngineService, useValue: pricingEngine },
        { provide: TripPricingService, useValue: tripPricingService },
        { provide: TripPricingItemService, useValue: tripPricingItemService },
        { provide: AppLoggerService, useValue: logger },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    // Mirrors main.ts so the tests exercise the real request pipeline.
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("a successful reprocess", () => {
    it("returns 200 with the stored snapshot and its breakdown", async () => {
      const response = await request(app.getHttpServer())
        .post(ROUTE)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pricing.id).toBe(PRICING_ID);
      expect(response.body.data.items).toHaveLength(2);
    });

    it("delegates to the Engine, which owns every precondition", async () => {
      await request(app.getHttpServer()).post(ROUTE).expect(200);

      expect(pricingEngine.reprocess).toHaveBeenCalledWith(TRIP_ID);
      expect(pricingEngine.reprocess).toHaveBeenCalledTimes(1);
    });

    it("exposes every snapshot field a caller needs", async () => {
      const { body } = await request(app.getHttpServer())
        .post(ROUTE)
        .expect(200);

      expect(body.data.pricing).toMatchObject({
        id: PRICING_ID,
        tripId: TRIP_ID,
        totalPrice: "499.50",
        currency: "EUR",
        pricingEngineVersion: "1.0.0",
        pricingRuleVersion: "2026.1",
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });
      expect(body.data.pricing.calculatedAt).toBeDefined();
    });

    it("exposes every line field, including the property reference", async () => {
      const { body } = await request(app.getHttpServer())
        .post(ROUTE)
        .expect(200);

      expect(body.data.items[1]).toMatchObject({
        pricingComponentId: "component-custom",
        customPropertyId: "property-flat",
        description: "Flat",
        amount: "119.50",
        currency: "EUR",
        calculationOrder: 7,
        quantity: null,
        unitPrice: null,
      });
      expect(body.data.items[0].customPropertyId).toBeNull();
    });

    it("keeps money as fixed-two-decimal strings, never JSON numbers", async () => {
      const { body } = await request(app.getHttpServer())
        .post(ROUTE)
        .expect(200);

      expect(typeof body.data.pricing.totalPrice).toBe("string");
      expect(body.data.pricing.totalPrice).toBe("499.50");
      expect(body.data.items.every((item: { amount: string }) => typeof item.amount === "string")).toBe(true);
    });

    it("reads the breakdown of the snapshot it just wrote", async () => {
      await request(app.getHttpServer()).post(ROUTE).expect(200);

      expect(tripPricingItemService.findByTripPricingId).toHaveBeenCalledWith(
        PRICING_ID,
      );
    });

    it("reads back from the database rather than echoing the calculation", async () => {
      // The response must describe what was persisted, so a caller can never be
      // shown a breakdown that differs from the stored one.
      await request(app.getHttpServer()).post(ROUTE).expect(200);

      expect(tripPricingService.findByTripId).toHaveBeenCalledWith(TRIP_ID);
    });
  });

  /**
   * The Engine's exceptions are not HTTP exceptions. Without the mapping filter
   * every one of these would surface as a generic 500.
   */
  describe("the Engine's domain failures are mapped, not hidden", () => {
    it("returns 404 for an unknown Trip", async () => {
      pricingEngine.reprocess.mockRejectedValue(
        new TripNotFoundForPricingException(TRIP_ID),
      );

      const response = await request(app.getHttpServer())
        .post(ROUTE)
        .expect(404);

      expect(response.body.error.message).toContain("does not exist");
    });

    it("returns 409 for a Trip that is not CLOSED", async () => {
      pricingEngine.reprocess.mockRejectedValue(
        new TripNotPriceableException(
          TRIP_ID,
          TripStatus.OPEN,
          TripStatus.CLOSED,
        ),
      );

      const response = await request(app.getHttpServer())
        .post(ROUTE)
        .expect(409);

      expect(response.body.error.message).toContain("OPEN");
    });

    it("returns 409 for an unusable pricing Setting", async () => {
      pricingEngine.reprocess.mockRejectedValue(
        new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"),
      );

      const response = await request(app.getHttpServer())
        .post(ROUTE)
        .expect(409);

      expect(response.body.error.message).toContain("FUEL_PERCENTAGE");
    });

    it("returns 409 for a route-priced property with no route cost", async () => {
      pricingEngine.reprocess.mockRejectedValue(
        new MissingRouteCostException(
          TRIP_ID,
          "component-toll",
          "Antwerp",
          "Rotterdam",
        ),
      );

      await request(app.getHttpServer()).post(ROUTE).expect(409);
    });

    it("never reports a pricing failure as a server error", async () => {
      pricingEngine.reprocess.mockRejectedValue(
        new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"),
      );

      const response = await request(app.getHttpServer()).post(ROUTE);

      expect(response.status).not.toBe(500);
      expect(response.body.error.message).not.toBe("Internal server error");
    });

    it("renders the failure in the standard envelope", async () => {
      pricingEngine.reprocess.mockRejectedValue(
        new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"),
      );

      const { body } = await request(app.getHttpServer()).post(ROUTE);

      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(409);
      expect(body.error.code).toBe("CONFLICT");
      expect(body.path).toBe(`/api/v1/trip-pricing/trip/${TRIP_ID}/reprocess`);
      expect(body.timestamp).toBeDefined();
    });

    it("still hides a genuinely unexpected error", async () => {
      pricingEngine.reprocess.mockRejectedValue(new Error("database on fire"));

      const response = await request(app.getHttpServer())
        .post(ROUTE)
        .expect(500);

      expect(response.body.error.message).toBe("Internal server error");
      expect(JSON.stringify(response.body)).not.toContain("on fire");
    });

    it("writes no response body from a failed read-back", async () => {
      pricingEngine.reprocess.mockRejectedValue(
        new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"),
      );

      await request(app.getHttpServer()).post(ROUTE).expect(409);

      expect(tripPricingService.findByTripId).not.toHaveBeenCalled();
    });
  });

  describe("request validation", () => {
    it("returns 400 for a malformed Trip id", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/trip-pricing/trip/not-a-uuid/reprocess")
        .expect(400);
    });

    it("does not reach the Engine for a malformed id", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/trip-pricing/trip/not-a-uuid/reprocess")
        .expect(400);

      expect(pricingEngine.reprocess).not.toHaveBeenCalled();
    });

    it("ignores a request body, which the operation does not accept", async () => {
      await request(app.getHttpServer())
        .post(ROUTE)
        .send({ totalPrice: 1 })
        .expect(200);
    });
  });

  describe("routes that do not exist", () => {
    it.each([
      ["/api/v1/trip-pricing/calculate", "a generic calculate endpoint"],
      [`/api/v1/trip-pricing/trip/${TRIP_ID}/calculate`, "a per-Trip calculate"],
    ])("exposes no %s (%s)", async (path) => {
      await request(app.getHttpServer()).post(path).expect(404);
    });

    it("exposes no GET on the reprocess path", async () => {
      await request(app.getHttpServer()).get(ROUTE).expect(404);
    });

    it("exposes no DELETE on the reprocess path", async () => {
      await request(app.getHttpServer()).delete(ROUTE).expect(404);
    });
  });

  it("performs no validation of its own", () => {
    const source = PricingReprocessController.prototype.constructor.toString();

    // Every precondition belongs to the Engine, so this adapter must not
    // re-check a status, a setting or a snapshot's existence.
    expect(source).not.toContain("CLOSED");
    expect(source).not.toContain("throw new");
    expect(source).not.toContain("findExistingSnapshot");
  });
});
