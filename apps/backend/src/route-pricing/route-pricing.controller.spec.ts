import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Prisma, RoutePricing } from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { RoutePricingController } from "./route-pricing.controller";
import { RoutePricingRepository } from "./route-pricing.repository";
import { RoutePricingService } from "./route-pricing.service";

const ROUTE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ROUTE_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const BASE = "/api/v1/route-pricing";

function buildRoutePricing(
  overrides: Partial<RoutePricing> = {},
): RoutePricing {
  return {
    id: ROUTE_ID,
    routeName: "Antwerp - Rotterdam",
    departure: "Antwerp",
    destination: "Rotterdam",
    basePrice: new Prisma.Decimal("380.00"),
    notes: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Integration tests: real routing, the global ValidationPipe, the response
 * interceptor and the exception filter all run. Only the repository is stubbed,
 * so no database is required while everything above it is exercised for real.
 */
describe("RoutePricingController (integration)", () => {
  let app: INestApplication;
  let repository: jest.Mocked<RoutePricingRepository>;

  beforeEach(async () => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findActiveByRoute: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildRoutePricing()),
      update: jest.fn().mockResolvedValue(buildRoutePricing()),
      setActive: jest.fn().mockResolvedValue(buildRoutePricing()),
    } as unknown as jest.Mocked<RoutePricingRepository>;

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RoutePricingController],
      providers: [
        RoutePricingService,
        { provide: RoutePricingRepository, useValue: repository },
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

  const validPayload = {
    routeName: "Antwerp - Rotterdam",
    departure: "Antwerp",
    destination: "Rotterdam",
    basePrice: 380,
  };

  describe("GET /route-pricing", () => {
    it("returns a paginated payload inside the standard envelope", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildRoutePricing()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          items: [
            expect.objectContaining({ id: ROUTE_ID, basePrice: "380.00" }),
          ],
          meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
        },
      });
    });

    it("applies pagination parameters", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?page=3&pageSize=10`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it("passes isActive=false as a filter rather than dropping it", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?isActive=false`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });

    it("omits the filter entirely when isActive is absent", async () => {
      await request(app.getHttpServer()).get(BASE).expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: undefined }),
      );
    });

    it("forwards a trimmed search term", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?search=%20rotterdam%20`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ search: "rotterdam" }),
      );
    });

    it.each(["page=0", "page=abc", "pageSize=0", "pageSize=1000", "bogus=1"])(
      "rejects invalid query %s",
      async (queryString) => {
        await request(app.getHttpServer())
          .get(`${BASE}?${queryString}`)
          .expect(400);
      },
    );
  });

  describe("GET /route-pricing/:id", () => {
    it("returns the record", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${ROUTE_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(ROUTE_ID);
    });

    it("returns 404 for an unknown id", async () => {
      repository.findById.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${ROUTE_ID}`)
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: { code: "NOT_FOUND" },
      });
    });

    it("returns 400 for a malformed UUID", async () => {
      await request(app.getHttpServer()).get(`${BASE}/not-a-uuid`).expect(400);
      expect(repository.findById).not.toHaveBeenCalled();
    });
  });

  describe("POST /route-pricing", () => {
    it("creates a record and answers 201", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send(validPayload)
        .expect(201);

      expect(response.body.data.id).toBe(ROUTE_ID);
    });

    it("trims the route fields before storing", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...validPayload, departure: "  Antwerp  " })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ departure: "Antwerp" }),
      );
    });

    it("stores a blank note as null", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...validPayload, notes: "   " })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ notes: null }),
      );
    });

    it("accepts a zero price", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...validPayload, basePrice: 0 })
        .expect(201);
    });

    it.each([
      ["missing routeName", { ...validPayload, routeName: undefined }],
      ["blank departure", { ...validPayload, departure: "   " }],
      ["missing basePrice", { ...validPayload, basePrice: undefined }],
      ["negative price", { ...validPayload, basePrice: -1 }],
      ["three-decimal price", { ...validPayload, basePrice: 10.123 }],
      ["price above NUMERIC(12,2)", { ...validPayload, basePrice: 1e13 }],
      ["price as string", { ...validPayload, basePrice: "380" }],
      ["price as boolean", { ...validPayload, basePrice: true }],
      ["non-string departure", { ...validPayload, departure: 42 }],
      ["oversized routeName", { ...validPayload, routeName: "x".repeat(201) }],
      ["unknown field", { ...validPayload, isActive: false }],
    ])("rejects %s with 400", async (_label, payload) => {
      await request(app.getHttpServer()).post(BASE).send(payload).expect(400);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("returns 409 when an active record already covers the route", async () => {
      repository.findActiveByRoute.mockResolvedValue(
        buildRoutePricing({ id: OTHER_ROUTE_ID }),
      );

      const response = await request(app.getHttpServer())
        .post(BASE)
        .send(validPayload)
        .expect(409);

      expect(response.body.error.message).toContain("Antwerp");
      expect(response.body.error.message).toContain("Rotterdam");
    });
  });

  describe("PATCH /route-pricing/:id", () => {
    it("updates the record", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());
      repository.update.mockResolvedValue(
        buildRoutePricing({ basePrice: new Prisma.Decimal("400.00") }),
      );

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_ID}`)
        .send({ basePrice: 400 })
        .expect(200);

      expect(response.body.data.basePrice).toBe("400.00");
    });

    it("clears the notes when null is sent", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing({ notes: "old" }));

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_ID}`)
        .send({ notes: null })
        .expect(200);

      expect(repository.update).toHaveBeenCalledWith(
        ROUTE_ID,
        expect.objectContaining({ notes: null }),
      );
    });

    it.each(["routeName", "departure", "destination"])(
      "rejects a null %s, because the column is NOT NULL",
      async (field) => {
        repository.findById.mockResolvedValue(buildRoutePricing());

        await request(app.getHttpServer())
          .patch(`${BASE}/${ROUTE_ID}`)
          .send({ [field]: null })
          .expect(400);

        expect(repository.update).not.toHaveBeenCalled();
      },
    );

    it("rejects an attempt to change isActive through update", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_ID}`)
        .send({ isActive: false })
        .expect(400);
    });

    it("returns 404 for an unknown record", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_ID}`)
        .send({ basePrice: 400 })
        .expect(404);
    });

    it("returns 409 when the new route is already covered", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());
      repository.findActiveByRoute.mockResolvedValue(
        buildRoutePricing({ id: OTHER_ROUTE_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_ID}`)
        .send({ destination: "Gent" })
        .expect(409);
    });
  });

  describe("activation and deactivation", () => {
    it("deactivates without removing the record", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());
      repository.setActive.mockResolvedValue(
        buildRoutePricing({ isActive: false }),
      );

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_ID}/deactivation`)
        .expect(200);

      expect(response.body.data.isActive).toBe(false);
      expect(repository.setActive).toHaveBeenCalledWith(ROUTE_ID, false);
    });

    it("activates a previously deactivated record", async () => {
      repository.findById.mockResolvedValue(
        buildRoutePricing({ isActive: false }),
      );
      repository.setActive.mockResolvedValue(
        buildRoutePricing({ isActive: true }),
      );

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_ID}/activation`)
        .expect(200);

      expect(response.body.data.isActive).toBe(true);
    });

    it("returns 409 when activation would duplicate an active route", async () => {
      repository.findById.mockResolvedValue(
        buildRoutePricing({ isActive: false }),
      );
      repository.findActiveByRoute.mockResolvedValue(
        buildRoutePricing({ id: OTHER_ROUTE_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_ID}/activation`)
        .expect(409);
    });

    it("returns 404 for an unknown record", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_ID}/deactivation`)
        .expect(404);
    });
  });

  it("exposes no DELETE route", async () => {
    repository.findById.mockResolvedValue(buildRoutePricing());

    await request(app.getHttpServer()).delete(`${BASE}/${ROUTE_ID}`).expect(404);
  });
});
