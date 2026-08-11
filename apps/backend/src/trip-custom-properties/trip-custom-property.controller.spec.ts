import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { CustomProperty, Prisma } from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripService } from "../trips/trip.service";
import { TripCustomPropertyController } from "./trip-custom-property.controller";
import {
  TripCustomPropertyRepository,
  TripCustomPropertyWithProperty,
} from "./trip-custom-property.repository";
import { TripCustomPropertyService } from "./trip-custom-property.service";

const ASSIGNMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ASSIGNMENT_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const TRIP_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PROPERTY_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const BASE = "/api/v1/trip-custom-properties";

function buildProperty(overrides: Partial<CustomProperty> = {}): CustomProperty {
  return {
    id: PROPERTY_ID,
    name: "TAR",
    description: null,
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

const VALID_BODY = { tripId: TRIP_ID, customPropertyId: PROPERTY_ID };

/**
 * Integration tests: real routing, the global ValidationPipe, the response
 * interceptor and the exception filter all run. Only the repository and the two
 * collaborating services are stubbed, so no database is required while
 * everything above it is exercised for real.
 */
describe("TripCustomPropertyController (integration)", () => {
  let app: INestApplication;
  let repository: jest.Mocked<TripCustomPropertyRepository>;
  let tripService: { findById: jest.Mock };
  let customPropertyService: { findById: jest.Mock };

  beforeEach(async () => {
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

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TripCustomPropertyController],
      providers: [
        TripCustomPropertyService,
        { provide: TripCustomPropertyRepository, useValue: repository },
        { provide: TripService, useValue: tripService },
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

  describe("GET /trip-custom-properties/trip/:tripId", () => {
    it("returns the assignments in the standard envelope", async () => {
      repository.findByTripId.mockResolvedValue([
        buildAssignment(),
        buildAssignment({
          id: OTHER_ASSIGNMENT_ID,
          customProperty: buildProperty({ name: "Flat", displayOrder: 2 }),
        }),
      ]);

      const response = await request(app.getHttpServer())
        .get(`${BASE}/trip/${TRIP_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toHaveLength(2);
      expect(response.body.data.items[0].customProperty.name).toBe("TAR");
    });

    it("nests the property with its price as a fixed-decimal string", async () => {
      repository.findByTripId.mockResolvedValue([buildAssignment()]);

      const response = await request(app.getHttpServer())
        .get(`${BASE}/trip/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data.items[0].customProperty.defaultPrice).toBe(
        "35.00",
      );
    });

    it("returns an empty list for a Trip with no properties", async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/trip/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data.items).toEqual([]);
    });

    it("carries no pagination metadata", async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/trip/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data).not.toHaveProperty("meta");
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

  describe("POST /trip-custom-properties", () => {
    it("assigns the property", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send(VALID_BODY)
        .expect(201);

      expect(response.body.data.tripId).toBe(TRIP_ID);
      expect(response.body.data.customPropertyId).toBe(PROPERTY_ID);
      expect(response.body.data.assignedAt).toBeDefined();
    });

    it("returns 404 when the Trip does not exist", async () => {
      tripService.findById.mockRejectedValue(new NotFoundException());

      await request(app.getHttpServer()).post(BASE).send(VALID_BODY).expect(404);
    });

    it("returns 404 when the property does not exist", async () => {
      customPropertyService.findById.mockRejectedValue(new NotFoundException());

      await request(app.getHttpServer()).post(BASE).send(VALID_BODY).expect(404);
    });

    it("returns 409 for an inactive property", async () => {
      customPropertyService.findById.mockResolvedValue({
        id: PROPERTY_ID,
        isActive: false,
      });

      await request(app.getHttpServer()).post(BASE).send(VALID_BODY).expect(409);
    });

    it("returns 409 for a duplicate assignment", async () => {
      repository.findByTripAndProperty.mockResolvedValue(
        buildAssignment({ id: OTHER_ASSIGNMENT_ID }),
      );

      await request(app.getHttpServer()).post(BASE).send(VALID_BODY).expect(409);
    });

    it.each([
      [{}, "an empty body"],
      [{ tripId: TRIP_ID }, "a missing property id"],
      [{ customPropertyId: PROPERTY_ID }, "a missing Trip id"],
      [{ ...VALID_BODY, tripId: "not-a-uuid" }, "a malformed Trip id"],
      [
        { ...VALID_BODY, customPropertyId: "not-a-uuid" },
        "a malformed property id",
      ],
      [{ ...VALID_BODY, tripId: 42 }, "a non-string Trip id"],
      [{ ...VALID_BODY, notes: "why" }, "assignment notes, a future field"],
      [{ ...VALID_BODY, priceOverride: 40 }, "a price override, a future field"],
      [{ ...VALID_BODY, unknown: 1 }, "an unknown field"],
    ])("rejects %j (%s)", async (body, _reason) => {
      await request(app.getHttpServer()).post(BASE).send(body).expect(400);
    });
  });

  describe("DELETE /trip-custom-properties/:id", () => {
    it("removes the assignment and returns what was removed", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      const response = await request(app.getHttpServer())
        .delete(`${BASE}/${ASSIGNMENT_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(ASSIGNMENT_ID);
      expect(repository.delete).toHaveBeenCalledWith(ASSIGNMENT_ID);
    });

    it("returns 200 rather than 204, so the envelope stays valid", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      const response = await request(app.getHttpServer())
        .delete(`${BASE}/${ASSIGNMENT_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.statusCode).toBe(200);
    });

    it("returns 404 for an unknown assignment", async () => {
      await request(app.getHttpServer())
        .delete(`${BASE}/${ASSIGNMENT_ID}`)
        .expect(404);
    });

    it("returns 400 for a malformed id", async () => {
      await request(app.getHttpServer()).delete(`${BASE}/not-a-uuid`).expect(400);
    });
  });

  describe("routes that do not exist", () => {
    it("exposes no collection listing of every assignment", async () => {
      await request(app.getHttpServer()).get(BASE).expect(404);
    });

    it("exposes no update, because an assignment carries nothing to change", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${ASSIGNMENT_ID}`)
        .send({})
        .expect(404);
    });

    it("exposes no bulk removal for a whole Trip", async () => {
      await request(app.getHttpServer())
        .delete(`${BASE}/trip/${TRIP_ID}`)
        .expect(404);
    });
  });
});
