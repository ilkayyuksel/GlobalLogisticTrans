import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Prisma, TripPricingItem } from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { TripPricingItemController } from "./trip-pricing-item.controller";
import { TripPricingItemRepository } from "./trip-pricing-item.repository";
import { TripPricingItemService } from "./trip-pricing-item.service";

const ITEM_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ITEM_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const PRICING_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const COMPONENT_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PROPERTY_ID = "4d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const BASE = "/api/v1/trip-pricing-items";

function buildItem(overrides: Partial<TripPricingItem> = {}): TripPricingItem {
  return {
    id: ITEM_ID,
    tripPricingId: PRICING_ID,
    pricingComponentId: COMPONENT_ID,
    customPropertyId: null,
    description: "Fuel surcharge",
    amount: new Prisma.Decimal("57.25"),
    currency: "EUR",
    calculationOrder: 3,
    quantity: null,
    unitPrice: null,
    notes: null,
    createdAt: new Date("2026-08-11T09:15:00.000Z"),
    updatedAt: new Date("2026-08-11T09:15:00.000Z"),
    ...overrides,
  };
}

const VALID_BODY = {
  tripPricingId: PRICING_ID,
  pricingComponentId: COMPONENT_ID,
  description: "Fuel surcharge",
  amount: 57.25,
  calculationOrder: 3,
};

/**
 * Integration tests: real routing, the global ValidationPipe, the response
 * interceptor and the exception filter all run. Only the repository and the two
 * collaborating services are stubbed, so no database is required while
 * everything above it is exercised for real.
 */
describe("TripPricingItemController (integration)", () => {
  let app: INestApplication;
  let repository: jest.Mocked<TripPricingItemRepository>;
  let tripPricingService: { findById: jest.Mock };
  let customPropertyService: { findById: jest.Mock };

  beforeEach(async () => {
    repository = {
      findById: jest.fn().mockResolvedValue(null),
      findByTripPricingId: jest.fn().mockResolvedValue([]),
      findByCustomProperty: jest.fn().mockResolvedValue(null),
      findPricingComponentById: jest.fn().mockResolvedValue({
        id: COMPONENT_ID,
        code: "FUEL_SURCHARGE",
        isActive: true,
      }),
      create: jest.fn().mockResolvedValue(buildItem()),
      update: jest.fn().mockResolvedValue(buildItem()),
    } as unknown as jest.Mocked<TripPricingItemRepository>;

    tripPricingService = {
      findById: jest.fn().mockResolvedValue({ id: PRICING_ID }),
    };
    customPropertyService = {
      findById: jest.fn().mockResolvedValue({ id: PROPERTY_ID, isActive: true }),
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
      controllers: [TripPricingItemController],
      providers: [
        TripPricingItemService,
        { provide: TripPricingItemRepository, useValue: repository },
        { provide: TripPricingService, useValue: tripPricingService },
        { provide: CustomPropertyService, useValue: customPropertyService },
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

  describe("GET /trip-pricing-items/trip-pricing/:tripPricingId", () => {
    it("returns the breakdown in the standard envelope", async () => {
      repository.findByTripPricingId.mockResolvedValue([
        buildItem(),
        buildItem({ id: OTHER_ITEM_ID, calculationOrder: 5 }),
      ]);

      const response = await request(app.getHttpServer())
        .get(`${BASE}/trip-pricing/${PRICING_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toHaveLength(2);
      expect(response.body.data.items[0].amount).toBe("57.25");
    });

    it("returns an empty breakdown when the snapshot has no lines", async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/trip-pricing/${PRICING_ID}`)
        .expect(200);

      expect(response.body.data.items).toEqual([]);
    });

    it("carries no pagination metadata, because a breakdown is whole", async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/trip-pricing/${PRICING_ID}`)
        .expect(200);

      expect(response.body.data).not.toHaveProperty("meta");
    });

    it("returns 404 when the snapshot does not exist", async () => {
      tripPricingService.findById.mockRejectedValue(new NotFoundException());

      await request(app.getHttpServer())
        .get(`${BASE}/trip-pricing/${PRICING_ID}`)
        .expect(404);
    });

    it("returns 400 for a malformed snapshot id", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/trip-pricing/not-a-uuid`)
        .expect(400);
    });
  });

  describe("GET /trip-pricing-items/:id", () => {
    it("returns the item", async () => {
      repository.findById.mockResolvedValue(buildItem());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${ITEM_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(ITEM_ID);
      expect(response.body.data.currency).toBe("EUR");
    });

    it("returns 400 for a malformed id", async () => {
      await request(app.getHttpServer()).get(`${BASE}/not-a-uuid`).expect(400);
    });

    it("returns 404 for an unknown id", async () => {
      await request(app.getHttpServer()).get(`${BASE}/${ITEM_ID}`).expect(404);
    });
  });

  describe("POST /trip-pricing-items", () => {
    it("creates an item", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send(VALID_BODY)
        .expect(201);

      expect(response.body.data.calculationOrder).toBe(3);
    });

    it("trims the description", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...VALID_BODY, description: "  Fuel surcharge  " })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Fuel surcharge" }),
      );
    });

    it("returns 404 when the snapshot does not exist", async () => {
      tripPricingService.findById.mockRejectedValue(new NotFoundException());

      await request(app.getHttpServer()).post(BASE).send(VALID_BODY).expect(404);
    });

    it("returns 404 when the pricing component does not exist", async () => {
      repository.findPricingComponentById.mockResolvedValue(null);

      await request(app.getHttpServer()).post(BASE).send(VALID_BODY).expect(404);
    });

    it("returns 409 when the pricing component is inactive", async () => {
      repository.findPricingComponentById.mockResolvedValue({
        id: COMPONENT_ID,
        code: "FUEL_SURCHARGE",
        isActive: false,
      });

      await request(app.getHttpServer()).post(BASE).send(VALID_BODY).expect(409);
    });

    it("returns 409 for a reference entity on a non-custom-property item", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...VALID_BODY, customPropertyId: PROPERTY_ID })
        .expect(409);
    });

    describe("on a CUSTOM_PROPERTY item", () => {
      beforeEach(() => {
        repository.findPricingComponentById.mockResolvedValue({
          id: COMPONENT_ID,
          code: "CUSTOM_PROPERTY",
          isActive: true,
        });
      });

      it("accepts the reference entity", async () => {
        await request(app.getHttpServer())
          .post(BASE)
          .send({ ...VALID_BODY, customPropertyId: PROPERTY_ID })
          .expect(201);
      });

      it("returns 404 when the custom property does not exist", async () => {
        customPropertyService.findById.mockRejectedValue(
          new NotFoundException(),
        );

        await request(app.getHttpServer())
          .post(BASE)
          .send({ ...VALID_BODY, customPropertyId: PROPERTY_ID })
          .expect(404);
      });

      it("returns 409 when that property is already priced here", async () => {
        repository.findByCustomProperty.mockResolvedValue(
          buildItem({ id: OTHER_ITEM_ID }),
        );

        await request(app.getHttpServer())
          .post(BASE)
          .send({ ...VALID_BODY, customPropertyId: PROPERTY_ID })
          .expect(409);
      });
    });

    it.each([
      [{}, "an empty body"],
      [{ ...VALID_BODY, tripPricingId: "not-a-uuid" }, "a malformed snapshot id"],
      [
        { ...VALID_BODY, pricingComponentId: "not-a-uuid" },
        "a malformed component id",
      ],
      [
        { ...VALID_BODY, customPropertyId: "not-a-uuid" },
        "a malformed property id",
      ],
      [{ ...VALID_BODY, description: "   " }, "a blank description"],
      [{ ...VALID_BODY, description: 42 }, "a non-string description"],
      [{ ...VALID_BODY, amount: 10.123 }, "three decimals of amount"],
      [{ ...VALID_BODY, amount: "57.25" }, "a string amount"],
      [{ ...VALID_BODY, amount: 10_000_000_000 }, "an amount beyond the column"],
      [{ ...VALID_BODY, amount: -10_000_000_000 }, "a negative beyond the column"],
      [{ ...VALID_BODY, calculationOrder: 0 }, "a zero calculation order"],
      [{ ...VALID_BODY, calculationOrder: -1 }, "a negative calculation order"],
      [{ ...VALID_BODY, calculationOrder: 1.5 }, "a fractional order"],
      [{ ...VALID_BODY, quantity: -1 }, "a negative quantity"],
      [{ ...VALID_BODY, quantity: 1.005 }, "three decimals of quantity"],
      [{ ...VALID_BODY, unitPrice: 1.005 }, "three decimals of unit price"],
      [{ ...VALID_BODY, currency: "USD" }, "a currency, which is not accepted"],
      [{ ...VALID_BODY, unknown: 1 }, "an unknown field"],
    ])("rejects %j (%s)", async (body, _reason) => {
      await request(app.getHttpServer()).post(BASE).send(body).expect(400);
    });

    it("accepts a negative amount, which the primary document allows", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...VALID_BODY, amount: -12.5 })
        .expect(201);
    });

    it("accepts a zero amount and a zero quantity", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...VALID_BODY, amount: 0, quantity: 0 })
        .expect(201);
    });

    it("accepts a negative unit price, for the same reason as the amount", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...VALID_BODY, unitPrice: -19.5 })
        .expect(201);
    });
  });

  describe("PATCH /trip-pricing-items/:id", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildItem());
    });

    it("updates the note", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${ITEM_ID}`)
        .send({ notes: "verified" })
        .expect(200);

      expect(repository.update).toHaveBeenCalledWith(ITEM_ID, {
        notes: "verified",
      });
    });

    it("clears the note with null", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${ITEM_ID}`)
        .send({ notes: null })
        .expect(200);

      expect(repository.update.mock.calls[0][1].notes).toBeNull();
    });

    it("accepts an empty body as a no-op", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${ITEM_ID}`)
        .send({})
        .expect(200);
    });

    it.each([
      ["amount", 999.99],
      ["quantity", 5],
      ["unitPrice", 20],
      ["currency", "USD"],
      ["description", "Something else"],
      ["calculationOrder", 9],
      ["pricingComponentId", COMPONENT_ID],
      ["customPropertyId", PROPERTY_ID],
      ["tripPricingId", PRICING_ID],
    ])("rejects %s, which is immutable", async (field, value) => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${ITEM_ID}`)
        .send({ [field]: value })
        .expect(400);
    });

    it("returns 404 for an unknown item", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${ITEM_ID}`)
        .send({ notes: "x" })
        .expect(404);
    });

    it("returns 400 for a malformed id", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/not-a-uuid`)
        .send({})
        .expect(400);
    });
  });

  describe("DELETE", () => {
    it("is not routed for an item, because pricing items are never removed", async () => {
      await request(app.getHttpServer()).delete(`${BASE}/${ITEM_ID}`).expect(404);
    });

    it("is not routed for a whole breakdown either", async () => {
      // Replacing a breakdown is reprocessing, and belongs to the Engine.
      await request(app.getHttpServer())
        .delete(`${BASE}/trip-pricing/${PRICING_ID}`)
        .expect(404);
    });
  });

  describe("no collection or replace endpoint", () => {
    it("does not expose every item at the collection root", async () => {
      await request(app.getHttpServer()).get(BASE).expect(404);
    });

    it("does not accept a PUT replacing a breakdown", async () => {
      await request(app.getHttpServer())
        .put(`${BASE}/trip-pricing/${PRICING_ID}`)
        .send({ items: [] })
        .expect(404);
    });
  });
});
