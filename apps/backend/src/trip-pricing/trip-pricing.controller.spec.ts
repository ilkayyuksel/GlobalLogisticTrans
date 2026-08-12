import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import {
  PricingCalculationStatus,
  Prisma,
  TripPricing,
  TripStatus,
} from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripService } from "../trips/trip.service";
import { TripPricingController } from "./trip-pricing.controller";
import { TripPricingRepository } from "./trip-pricing.repository";
import { TripPricingService } from "./trip-pricing.service";

const PRICING_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TRIP_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const BASE = "/api/v1/trip-pricing";

function buildTripPricing(overrides: Partial<TripPricing> = {}): TripPricing {
  return {
    id: PRICING_ID,
    tripId: TRIP_ID,
    totalPrice: new Prisma.Decimal("482.35"),
    currency: "EUR",
    calculatedAt: new Date("2026-08-11T09:15:00.000Z"),
    pricingEngineVersion: "1.4.0",
    pricingRuleVersion: "2026.08",
    calculationStatus: PricingCalculationStatus.CALCULATED,
    notes: null,
    createdAt: new Date("2026-08-11T09:15:00.000Z"),
    updatedAt: new Date("2026-08-11T09:15:00.000Z"),
    ...overrides,
  };
}

/**
 * Integration tests: real routing, the global ValidationPipe, the response
 * interceptor and the exception filter all run. Only the repository and
 * TripService are stubbed, so no database is required while everything above it
 * is exercised for real.
 */
describe("TripPricingController (integration)", () => {
  let app: INestApplication;
  let repository: jest.Mocked<TripPricingRepository>;
  let tripService: { findById: jest.Mock };

  beforeEach(async () => {
    repository = {
      findById: jest.fn().mockResolvedValue(null),
      findByTripId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildTripPricing()),
      update: jest.fn().mockResolvedValue(buildTripPricing()),
    } as unknown as jest.Mocked<TripPricingRepository>;

    tripService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: TRIP_ID, status: TripStatus.CLOSED }),
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
      controllers: [TripPricingController],
      providers: [
        TripPricingService,
        { provide: TripPricingRepository, useValue: repository },
        { provide: TripService, useValue: tripService },
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

  describe("GET /trip-pricing/:id", () => {
    it("returns the snapshot in the standard envelope", async () => {
      repository.findById.mockResolvedValue(buildTripPricing());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${PRICING_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(PRICING_ID);
      expect(response.body.data.totalPrice).toBe("482.35");
      expect(response.body.data.currency).toBe("EUR");
    });

    it("returns 400 for a malformed id", async () => {
      await request(app.getHttpServer()).get(`${BASE}/not-a-uuid`).expect(400);
    });

    it("returns 404 for an unknown id", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/${PRICING_ID}`)
        .expect(404);
    });
  });

  describe("GET /trip-pricing/trip/:tripId", () => {
    it("returns the snapshot belonging to the Trip", async () => {
      repository.findByTripId.mockResolvedValue(buildTripPricing());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/trip/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data.tripId).toBe(TRIP_ID);
    });

    it("returns null when the Trip has no snapshot yet", async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/trip/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data).toBeNull();
    });

    it("returns 404 when the Trip does not exist", async () => {
      tripService.findById.mockRejectedValue(new NotFoundException());

      await request(app.getHttpServer())
        .get(`${BASE}/trip/${TRIP_ID}`)
        .expect(404);
    });

    it("returns 400 for a malformed Trip id", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/trip/not-a-uuid`)
        .expect(400);
    });
  });

  describe("PATCH /trip-pricing/:id", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildTripPricing());
    });

    it("updates the calculation status", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${PRICING_ID}`)
        .send({ calculationStatus: "MANUAL_OVERRIDE" })
        .expect(200);

      expect(repository.update).toHaveBeenCalledWith(
        PRICING_ID,
        expect.objectContaining({
          calculationStatus: PricingCalculationStatus.MANUAL_OVERRIDE,
        }),
      );
    });

    it("clears the note with null", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${PRICING_ID}`)
        .send({ notes: null })
        .expect(200);

      expect(repository.update.mock.calls[0][1].notes).toBeNull();
    });

    it("accepts an empty body as a no-op", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${PRICING_ID}`)
        .send({})
        .expect(200);
    });

    it.each([
      ["totalPrice", 999.99],
      ["currency", "USD"],
      ["calculatedAt", "2026-08-12T00:00:00.000Z"],
      ["pricingEngineVersion", "2.0.0"],
      ["pricingRuleVersion", "2026.09"],
      ["tripId", TRIP_ID],
    ])("rejects %s, which is immutable", async (field, value) => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${PRICING_ID}`)
        .send({ [field]: value })
        .expect(400);
    });

    it("rejects an unknown calculation status", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${PRICING_ID}`)
        .send({ calculationStatus: "PENDING" })
        .expect(400);
    });

    it("returns 404 for an unknown snapshot", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${PRICING_ID}`)
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
    it("is not routed for a snapshot, because pricing is never removed", async () => {
      await request(app.getHttpServer())
        .delete(`${BASE}/${PRICING_ID}`)
        .expect(404);
    });

    it("is not routed for a Trip's snapshot either", async () => {
      await request(app.getHttpServer())
        .delete(`${BASE}/trip/${TRIP_ID}`)
        .expect(404);
    });
  });

  describe("no list endpoint", () => {
    it("does not expose every snapshot at the collection root", async () => {
      // Snapshots are reached through their Trip or their own id. A bare list
      // would publish the whole revenue history in one request.
      await request(app.getHttpServer()).get(BASE).expect(404);
    });
  });
});
