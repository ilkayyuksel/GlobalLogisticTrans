import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { CustomProperty, Prisma } from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { CustomPropertyController } from "./custom-property.controller";
import { CustomPropertyRepository } from "./custom-property.repository";
import { CustomPropertyService } from "./custom-property.service";

const PROPERTY_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_PROPERTY_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const BASE = "/api/v1/custom-properties";

function buildProperty(
  overrides: Partial<CustomProperty> = {},
): CustomProperty {
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

/**
 * Integration tests: real routing, the global ValidationPipe, the response
 * interceptor and the exception filter all run. Only the repository is stubbed,
 * so no database is required while everything above it is exercised for real.
 */
describe("CustomPropertyController (integration)", () => {
  let app: INestApplication;
  let repository: jest.Mocked<CustomPropertyRepository>;

  beforeEach(async () => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findActiveByName: jest.fn().mockResolvedValue(null),
      findHighestDisplayOrder: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildProperty()),
      update: jest.fn().mockResolvedValue(buildProperty()),
      setActive: jest.fn().mockResolvedValue(buildProperty()),
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<CustomPropertyRepository>;

    repository.runInTransaction.mockImplementation(
      (work: (repo: CustomPropertyRepository) => Promise<unknown>) =>
        work(repository),
    );

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [CustomPropertyController],
      providers: [
        CustomPropertyService,
        { provide: CustomPropertyRepository, useValue: repository },
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

  describe("GET /custom-properties", () => {
    it("returns a paginated payload inside the standard envelope", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildProperty()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          items: [
            expect.objectContaining({
              id: PROPERTY_ID,
              defaultPrice: "35.00",
              displayOrder: 1,
            }),
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
        .get(`${BASE}?search=%20niklaas%20`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ search: "niklaas" }),
      );
    });

    it.each(["page=0", "pageSize=1000", "isActive=maybe", "bogus=1"])(
      "rejects invalid query %s",
      async (queryString) => {
        await request(app.getHttpServer())
          .get(`${BASE}?${queryString}`)
          .expect(400);
      },
    );
  });

  describe("GET /custom-properties/:id", () => {
    it("returns the property", async () => {
      repository.findById.mockResolvedValue(buildProperty());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${PROPERTY_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(PROPERTY_ID);
    });

    it("returns 404 for an unknown id", async () => {
      repository.findById.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${PROPERTY_ID}`)
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

  describe("POST /custom-properties", () => {
    it("creates a property and answers 201", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "TAR" })
        .expect(201);

      expect(response.body.data.id).toBe(PROPERTY_ID);
    });

    it("trims the name before storing", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "  TAR  " })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "TAR" }),
      );
    });

    it("normalises the colour to lowercase", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "TAR", color: "#F59E0B" })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ color: "#f59e0b" }),
      );
    });

    it("stores a blank description as null", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "TAR", description: "   " })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
      );
    });

    it("appends to the end when displayOrder is omitted", async () => {
      repository.findHighestDisplayOrder.mockResolvedValue(7);

      await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "TAR" })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ displayOrder: 8 }),
      );
    });

    it("accepts a zero price", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "Free extra", defaultPrice: 0 })
        .expect(201);
    });

    it.each([
      ["missing name", {}],
      ["blank name", { name: "   " }],
      ["non-string name", { name: 42 }],
      ["oversized name", { name: "x".repeat(101) }],
      ["negative price", { name: "TAR", defaultPrice: -1 }],
      ["three-decimal price", { name: "TAR", defaultPrice: 10.123 }],
      ["price as string", { name: "TAR", defaultPrice: "35" }],
      ["price above NUMERIC(12,2)", { name: "TAR", defaultPrice: 1e13 }],
      ["three-digit colour", { name: "TAR", color: "#fff" }],
      ["named colour", { name: "TAR", color: "orange" }],
      ["colour without hash", { name: "TAR", color: "f59e0b" }],
      ["negative displayOrder", { name: "TAR", displayOrder: -1 }],
      ["non-integer displayOrder", { name: "TAR", displayOrder: 1.5 }],
      ["unknown field", { name: "TAR", isActive: false }],
    ])("rejects %s with 400", async (_label, payload) => {
      await request(app.getHttpServer()).post(BASE).send(payload).expect(400);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("returns 409 when an active property already uses the name", async () => {
      repository.findActiveByName.mockResolvedValue(
        buildProperty({ id: OTHER_PROPERTY_ID }),
      );

      const response = await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "TAR" })
        .expect(409);

      expect(response.body.error.code).toBe("CONFLICT");
      expect(response.body.error.message).toContain("TAR");
    });
  });

  describe("PATCH /custom-properties/:id", () => {
    it("updates the property", async () => {
      repository.findById.mockResolvedValue(buildProperty());
      repository.update.mockResolvedValue(buildProperty({ displayOrder: 9 }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${PROPERTY_ID}`)
        .send({ displayOrder: 9 })
        .expect(200);

      expect(response.body.data.displayOrder).toBe(9);
    });

    it("clears the price when null is sent", async () => {
      repository.findById.mockResolvedValue(buildProperty());
      repository.update.mockResolvedValue(buildProperty({ defaultPrice: null }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${PROPERTY_ID}`)
        .send({ defaultPrice: null })
        .expect(200);

      expect(response.body.data.defaultPrice).toBeNull();
    });

    it.each(["name", "displayOrder"])(
      "rejects a null %s, because the column is NOT NULL",
      async (field) => {
        repository.findById.mockResolvedValue(buildProperty());

        await request(app.getHttpServer())
          .patch(`${BASE}/${PROPERTY_ID}`)
          .send({ [field]: null })
          .expect(400);

        expect(repository.update).not.toHaveBeenCalled();
      },
    );

    it("rejects an attempt to change isActive through update", async () => {
      repository.findById.mockResolvedValue(buildProperty());

      await request(app.getHttpServer())
        .patch(`${BASE}/${PROPERTY_ID}`)
        .send({ isActive: false })
        .expect(400);
    });

    it("returns 404 for an unknown property", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${PROPERTY_ID}`)
        .send({ displayOrder: 2 })
        .expect(404);
    });

    it("returns 409 on a duplicate name", async () => {
      repository.findById.mockResolvedValue(buildProperty());
      repository.findActiveByName.mockResolvedValue(
        buildProperty({ id: OTHER_PROPERTY_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${PROPERTY_ID}`)
        .send({ name: "Flat" })
        .expect(409);
    });
  });

  describe("activation and deactivation", () => {
    it("deactivates without removing the record", async () => {
      repository.findById.mockResolvedValue(buildProperty());
      repository.setActive.mockResolvedValue(buildProperty({ isActive: false }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${PROPERTY_ID}/deactivation`)
        .expect(200);

      expect(response.body.data.isActive).toBe(false);
      expect(repository.setActive).toHaveBeenCalledWith(PROPERTY_ID, false);
    });

    it("activates a previously deactivated property", async () => {
      repository.findById.mockResolvedValue(buildProperty({ isActive: false }));
      repository.setActive.mockResolvedValue(buildProperty({ isActive: true }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${PROPERTY_ID}/activation`)
        .expect(200);

      expect(response.body.data.isActive).toBe(true);
    });

    it("returns 409 when activation would duplicate a name", async () => {
      repository.findById.mockResolvedValue(buildProperty({ isActive: false }));
      repository.findActiveByName.mockResolvedValue(
        buildProperty({ id: OTHER_PROPERTY_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${PROPERTY_ID}/activation`)
        .expect(409);
    });

    it("returns 404 for an unknown property", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${PROPERTY_ID}/deactivation`)
        .expect(404);
    });
  });

  it("exposes no DELETE route", async () => {
    repository.findById.mockResolvedValue(buildProperty());

    await request(app.getHttpServer())
      .delete(`${BASE}/${PROPERTY_ID}`)
      .expect(404);
  });
});
