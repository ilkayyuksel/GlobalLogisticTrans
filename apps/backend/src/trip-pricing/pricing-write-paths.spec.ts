import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingItemController } from "../trip-pricing-items/trip-pricing-item.controller";
import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { TripPricingItemService } from "../trip-pricing-items/trip-pricing-item.service";
import { TripService } from "../trips/trip.service";
import { TripPricingController } from "./trip-pricing.controller";
import { TripPricingRepository } from "./trip-pricing.repository";
import { TripPricingService } from "./trip-pricing.service";

const TRIP_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PRICING_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const ITEM_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const COMPONENT_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

/**
 * `trip_pricing.total_price` must equal the sum of its items — database_model.md
 * §4.13. That invariant spans two tables, so it can only hold if every write
 * that touches either one is atomic.
 *
 * §4.13 and §4.14 both name the Pricing Engine as the owner: "Only the Pricing
 * Engine may create or update TripPricingItems." These tests pin the API to
 * that rule. They assert the ABSENCE of the two write paths that could break
 * the invariant, because a route that does not exist cannot be misused, and
 * absence is exactly the kind of thing a later change removes by accident.
 */
describe("Pricing write paths (integration)", () => {
  let app: INestApplication;
  let tripPricingRepository: jest.Mocked<TripPricingRepository>;
  let itemRepository: jest.Mocked<TripPricingItemRepository>;

  beforeEach(async () => {
    tripPricingRepository = {
      findById: jest.fn().mockResolvedValue(null),
      findByTripId: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripPricingRepository>;

    itemRepository = {
      findById: jest.fn().mockResolvedValue(null),
      findByTripPricingId: jest.fn().mockResolvedValue([]),
      findPricingComponentsByCodes: jest.fn().mockResolvedValue([]),
      createMany: jest.fn(),
      deleteByTripPricingId: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<TripPricingItemRepository>;

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TripPricingController, TripPricingItemController],
      providers: [
        TripPricingService,
        TripPricingItemService,
        { provide: TripPricingRepository, useValue: tripPricingRepository },
        { provide: TripPricingItemRepository, useValue: itemRepository },
        { provide: TripService, useValue: { findById: jest.fn() } },
        { provide: AppLoggerService, useValue: logger },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
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

  /**
   * The audit proved this exact request produced total=499.50 with
   * sum(items)=524.50.
   */
  describe("a pricing line cannot be added on its own", () => {
    it("POST /trip-pricing-items does not exist", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/trip-pricing-items")
        .send({
          tripPricingId: PRICING_ID,
          pricingComponentId: COMPONENT_ID,
          description: "manual adjustment",
          amount: 25,
          calculationOrder: 8,
        })
        .expect(404);
    });

    it("writes nothing when such a request arrives", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/trip-pricing-items")
        .send({ tripPricingId: PRICING_ID, amount: 25 })
        .expect(404);

      expect(itemRepository.createMany).not.toHaveBeenCalled();
      expect(itemRepository.update).not.toHaveBeenCalled();
      expect(tripPricingRepository.update).not.toHaveBeenCalled();
    });

    it("offers no service method that could create one", () => {
      const methods = Object.getOwnPropertyNames(
        TripPricingItemService.prototype,
      );

      expect(methods).not.toContain("create");
      expect(methods).not.toContain("createMany");
      expect(methods).not.toContain("remove");
    });
  });

  /**
   * A snapshot whose total arrived from a caller could not be trusted to equal
   * the sum of its items — the audit created one with total=12345.67 and no
   * items at all.
   */
  describe("a snapshot cannot be created with a caller-supplied total", () => {
    it("POST /trip-pricing does not exist", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/trip-pricing")
        .send({
          tripId: TRIP_ID,
          totalPrice: 12345.67,
          calculatedAt: new Date().toISOString(),
          pricingEngineVersion: "forged",
          pricingRuleVersion: "forged",
          calculationStatus: "CALCULATED",
        })
        .expect(404);

      expect(tripPricingRepository.create).not.toHaveBeenCalled();
    });

    it("offers no service method that could create one", () => {
      const methods = Object.getOwnPropertyNames(TripPricingService.prototype);

      expect(methods).not.toContain("create");
      expect(methods).toContain("replaceSnapshot");
    });
  });

  /**
   * The remaining writes touch only fields no total depends on, so they cannot
   * put the two tables out of step.
   */
  describe("the writes that remain cannot affect a total", () => {
    it("PATCH /trip-pricing/{id} changes only the status and the note", async () => {
      tripPricingRepository.findById.mockResolvedValue({
        id: PRICING_ID,
        calculationStatus: "CALCULATED",
      } as never);
      tripPricingRepository.update.mockResolvedValue({
        id: PRICING_ID,
        tripId: TRIP_ID,
        calculationStatus: "CALCULATED",
        totalPrice: { toFixed: () => "499.50" },
        currency: "EUR",
        calculatedAt: new Date(),
        pricingEngineVersion: "1.0.0",
        pricingRuleVersion: "2026.1",
        notes: "checked",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      await request(app.getHttpServer())
        .patch(`/api/v1/trip-pricing/${PRICING_ID}`)
        .send({ notes: "checked", totalPrice: 1 })
        .expect(400);
    });

    it("PATCH /trip-pricing-items/{id} rejects any field but the note", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/trip-pricing-items/${ITEM_ID}`)
        .send({ amount: 999 })
        .expect(400);

      expect(itemRepository.update).not.toHaveBeenCalled();
    });

    it("the item update writes the note and nothing else", async () => {
      itemRepository.findById.mockResolvedValue({
        id: ITEM_ID,
        tripPricingId: PRICING_ID,
      } as never);
      itemRepository.update.mockResolvedValue({
        id: ITEM_ID,
        tripPricingId: PRICING_ID,
        pricingComponentId: COMPONENT_ID,
        // Loaded with the line, as every read of one now does.
        pricingComponent: { code: "TOLL" },
        customPropertyId: null,
        description: "Toll",
        amount: { toFixed: () => "9.75" },
        currency: "EUR",
        calculationOrder: 5,
        quantity: null,
        unitPrice: null,
        notes: "checked",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      await request(app.getHttpServer())
        .patch(`/api/v1/trip-pricing-items/${ITEM_ID}`)
        .send({ notes: "checked" })
        .expect(200);

      expect(itemRepository.update).toHaveBeenCalledWith(ITEM_ID, {
        notes: "checked",
      });
    });
  });

  it("leaves exactly one way to write a breakdown: the Engine's transaction", () => {
    const itemMethods = Object.getOwnPropertyNames(
      TripPricingItemRepository.prototype,
    );

    // createMany and deleteByTripPricingId are the two halves of the atomic
    // replacement; neither is reachable from a controller.
    expect(itemMethods).toContain("createMany");
    expect(itemMethods).toContain("deleteByTripPricingId");
    expect(itemMethods).not.toContain("create");

    const controllerSource =
      TripPricingItemController.prototype.constructor.toString();

    expect(controllerSource).not.toContain("createMany");
    expect(controllerSource).not.toContain("deleteByTripPricingId");
  });
});
