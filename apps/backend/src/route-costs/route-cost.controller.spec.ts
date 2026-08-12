import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { RouteCostController } from "./route-cost.controller";
import {
  RouteCostRepository,
  RouteCostWithComponent,
} from "./route-cost.repository";
import { RouteCostService } from "./route-cost.service";

const ROUTE_COST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ROUTE_COST_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const COMPONENT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const BASE = "/api/v1/route-costs";

const TOLL_COMPONENT = { id: COMPONENT_ID, code: "TOLL", name: "Toll" };

function buildRouteCost(
  overrides: Partial<RouteCostWithComponent> = {},
): RouteCostWithComponent {
  return {
    id: ROUTE_COST_ID,
    departure: "Antwerp Terminal",
    destination: "Rotterdam",
    pricingComponentId: COMPONENT_ID,
    amount: new Prisma.Decimal("24.50"),
    notes: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    pricingComponent: TOLL_COMPONENT,
    ...overrides,
  };
}

const VALID_BODY = {
  departure: "Antwerp Terminal",
  destination: "Rotterdam",
  pricingComponentId: COMPONENT_ID,
  amount: 24.5,
};

/**
 * Integration tests: real routing, the global ValidationPipe, the response
 * interceptor and the exception filter all run. Only the repository is stubbed,
 * so no database is required while everything above it is exercised for real.
 */
describe("RouteCostController (integration)", () => {
  let app: INestApplication;
  let repository: jest.Mocked<RouteCostRepository>;

  beforeEach(async () => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findActiveByRouteAndComponent: jest.fn().mockResolvedValue(null),
      findPricingComponent: jest.fn().mockResolvedValue(TOLL_COMPONENT),
      isRoutePricedComponent: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockResolvedValue(buildRouteCost()),
      update: jest.fn().mockResolvedValue(buildRouteCost()),
      setActive: jest.fn().mockResolvedValue(buildRouteCost()),
    } as unknown as jest.Mocked<RouteCostRepository>;

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RouteCostController],
      providers: [
        RouteCostService,
        { provide: RouteCostRepository, useValue: repository },
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

  describe("GET /route-costs", () => {
    it("returns a page in the standard envelope", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildRouteCost()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.meta.totalItems).toBe(1);
    });

    it("nests the component so the response is readable without a second call", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildRouteCost()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.data.items[0].pricingComponent).toEqual(
        TOLL_COMPONENT,
      );
    });

    it("serialises the amount as a string, never a JSON number", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildRouteCost()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.data.items[0].amount).toBe("24.50");
    });

    it("forwards the filters it was given", async () => {
      await request(app.getHttpServer())
        .get(BASE)
        .query({ isActive: "true", pricingComponentId: COMPONENT_ID, search: "rot" })
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
          pricingComponentId: COMPONENT_ID,
          search: "rot",
        }),
      );
    });

    it.each([
      ["page=0", { page: 0 }],
      ["a non-numeric page", { page: "abc" }],
      ["a non-boolean isActive", { isActive: "maybe" }],
      ["a malformed component id", { pricingComponentId: "not-a-uuid" }],
    ])("rejects %s", async (_reason, query) => {
      await request(app.getHttpServer()).get(BASE).query(query).expect(400);
    });
  });

  describe("GET /route-costs/:id", () => {
    it("returns the record", async () => {
      repository.findById.mockResolvedValue(buildRouteCost());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${ROUTE_COST_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(ROUTE_COST_ID);
    });

    it("returns an inactive record too", async () => {
      repository.findById.mockResolvedValue(buildRouteCost({ isActive: false }));

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${ROUTE_COST_ID}`)
        .expect(200);

      expect(response.body.data.isActive).toBe(false);
    });

    it("returns 404 for an unknown id", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/${ROUTE_COST_ID}`)
        .expect(404);
    });

    it("returns 400 for a malformed id", async () => {
      await request(app.getHttpServer()).get(`${BASE}/not-a-uuid`).expect(400);
    });
  });

  describe("POST /route-costs", () => {
    it("creates the record", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send(VALID_BODY)
        .expect(201);

      expect(response.body.data.id).toBe(ROUTE_COST_ID);
      expect(response.body.data.amount).toBe("24.50");
    });

    it("trims the locations before storing them", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...VALID_BODY, departure: "  Antwerp Terminal  " })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ departure: "Antwerp Terminal" }),
      );
    });

    it("accepts a zero amount, which is a configured free route", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...VALID_BODY, amount: 0 })
        .expect(201);
    });

    it("returns 404 when the component does not exist", async () => {
      repository.findPricingComponent.mockResolvedValue(null);

      await request(app.getHttpServer()).post(BASE).send(VALID_BODY).expect(404);
    });

    it("returns 409 when the component is not route-priced", async () => {
      repository.isRoutePricedComponent.mockResolvedValue(false);

      await request(app.getHttpServer()).post(BASE).send(VALID_BODY).expect(409);
    });

    it("returns 409 for a duplicate active record", async () => {
      repository.findActiveByRouteAndComponent.mockResolvedValue(
        buildRouteCost({ id: OTHER_ROUTE_COST_ID }),
      );

      await request(app.getHttpServer()).post(BASE).send(VALID_BODY).expect(409);
    });

    it.each([
      [{}, "an empty body"],
      [{ ...VALID_BODY, amount: -1 }, "a negative amount"],
      [{ ...VALID_BODY, amount: 24.567 }, "three decimals"],
      [{ ...VALID_BODY, amount: "24.50" }, "an amount sent as a string"],
      [{ ...VALID_BODY, amount: 10_000_000_000 }, "an amount past NUMERIC(12,2)"],
      [{ ...VALID_BODY, departure: "" }, "a blank departure"],
      [{ ...VALID_BODY, departure: "x".repeat(201) }, "an overlong departure"],
      [{ ...VALID_BODY, pricingComponentId: "not-a-uuid" }, "a malformed component id"],
      [{ ...VALID_BODY, isActive: false }, "isActive, which has its own endpoint"],
      [{ ...VALID_BODY, unknown: 1 }, "an unknown field"],
    ])("rejects %j (%s)", async (body, _reason) => {
      await request(app.getHttpServer()).post(BASE).send(body).expect(400);
    });

    it.each(["departure", "destination", "pricingComponentId", "amount"])(
      "rejects a body missing %s",
      async (field) => {
        const body: Record<string, unknown> = { ...VALID_BODY };
        delete body[field];

        await request(app.getHttpServer()).post(BASE).send(body).expect(400);
      },
    );
  });

  describe("PATCH /route-costs/:id", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildRouteCost());
    });

    it("updates the record", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_COST_ID}`)
        .send({ amount: 30 })
        .expect(200);

      expect(repository.update).toHaveBeenCalledWith(
        ROUTE_COST_ID,
        expect.objectContaining({ amount: 30 }),
      );
    });

    it("accepts an empty body as a no-op", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_COST_ID}`)
        .send({})
        .expect(200);
    });

    it("clears notes when null is sent", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_COST_ID}`)
        .send({ notes: null })
        .expect(200);

      expect(repository.update).toHaveBeenCalledWith(
        ROUTE_COST_ID,
        expect.objectContaining({ notes: null }),
      );
    });

    it("returns 404 for an unknown record", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_COST_ID}`)
        .send({ amount: 30 })
        .expect(404);
    });

    it("returns 409 when the new route is already taken", async () => {
      repository.findActiveByRouteAndComponent.mockResolvedValue(
        buildRouteCost({ id: OTHER_ROUTE_COST_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_COST_ID}`)
        .send({ destination: "Utrecht" })
        .expect(409);
    });

    it.each([
      [{ amount: -1 }, "a negative amount"],
      [{ departure: null }, "a null departure, which is NOT NULL"],
      [{ pricingComponentId: null }, "a null component, which is NOT NULL"],
      [{ isActive: true }, "isActive, which has its own endpoint"],
      [{ unknown: 1 }, "an unknown field"],
    ])("rejects %j (%s)", async (body, _reason) => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_COST_ID}`)
        .send(body)
        .expect(400);
    });
  });

  describe("activation and deactivation", () => {
    it("activates and returns 200", async () => {
      repository.findById.mockResolvedValue(buildRouteCost({ isActive: false }));

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_COST_ID}/activation`)
        .expect(200);

      expect(repository.setActive).toHaveBeenCalledWith(ROUTE_COST_ID, true);
    });

    it("returns 409 when another active record now covers the route", async () => {
      repository.findById.mockResolvedValue(buildRouteCost({ isActive: false }));
      repository.findActiveByRouteAndComponent.mockResolvedValue(
        buildRouteCost({ id: OTHER_ROUTE_COST_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_COST_ID}/activation`)
        .expect(409);
    });

    it("deactivates and returns 200", async () => {
      repository.findById.mockResolvedValue(buildRouteCost());

      await request(app.getHttpServer())
        .patch(`${BASE}/${ROUTE_COST_ID}/deactivation`)
        .expect(200);

      expect(repository.setActive).toHaveBeenCalledWith(ROUTE_COST_ID, false);
    });

    it.each(["activation", "deactivation"])(
      "returns 404 for an unknown record on %s",
      async (action) => {
        repository.findById.mockResolvedValue(null);

        await request(app.getHttpServer())
          .patch(`${BASE}/${ROUTE_COST_ID}/${action}`)
          .expect(404);
      },
    );
  });

  describe("routes that do not exist", () => {
    it("exposes no DELETE, because records are never removed", async () => {
      await request(app.getHttpServer())
        .delete(`${BASE}/${ROUTE_COST_ID}`)
        .expect(404);
    });

    it("exposes no calculation endpoint", async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/${ROUTE_COST_ID}/calculate`)
        .send({})
        .expect(404);
    });
  });
});
