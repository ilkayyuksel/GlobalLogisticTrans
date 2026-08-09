import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Driver } from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { DriverController } from "./driver.controller";
import { DriverRepository } from "./driver.repository";
import { DriverService } from "./driver.service";

const DRIVER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_DRIVER_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const BASE = "/api/v1/drivers";

function buildDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: DRIVER_ID,
    name: "Jan Peeters",
    licenceNumber: null,
    phoneNumber: null,
    email: null,
    emergencyContact: null,
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
describe("DriverController (integration)", () => {
  let app: INestApplication;
  let repository: jest.Mocked<DriverRepository>;

  beforeEach(async () => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findActiveByLicenceNumber: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildDriver()),
      update: jest.fn().mockResolvedValue(buildDriver()),
      setActive: jest.fn().mockResolvedValue(buildDriver()),
    } as unknown as jest.Mocked<DriverRepository>;

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DriverController],
      providers: [
        DriverService,
        { provide: DriverRepository, useValue: repository },
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

  describe("GET /drivers", () => {
    it("returns a paginated payload inside the standard envelope", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildDriver()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body).toMatchObject({
        success: true,
        statusCode: 200,
        data: {
          items: [expect.objectContaining({ id: DRIVER_ID })],
          meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
        },
      });
      expect(response.body.path).toBe(`${BASE}`);
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

    it.each(["page=0", "page=abc", "pageSize=0", "pageSize=1000"])(
      "rejects invalid pagination %s",
      async (queryString) => {
        await request(app.getHttpServer())
          .get(`${BASE}?${queryString}`)
          .expect(400);
      },
    );

    it("rejects an unknown query parameter", async () => {
      await request(app.getHttpServer()).get(`${BASE}?bogus=1`).expect(400);
    });
  });

  describe("GET /drivers/:id", () => {
    it("returns the driver", async () => {
      repository.findById.mockResolvedValue(buildDriver());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${DRIVER_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(DRIVER_ID);
    });

    it("returns 404 for an unknown id", async () => {
      repository.findById.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${DRIVER_ID}`)
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

  describe("POST /drivers", () => {
    it("creates a driver and answers 201", async () => {
      repository.create.mockResolvedValue(buildDriver());

      const response = await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "Jan Peeters" })
        .expect(201);

      expect(response.body.data.id).toBe(DRIVER_ID);
    });

    it("trims the name before storing", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "  Jan Peeters  " })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Jan Peeters" }),
      );
    });

    it("stores a blank licence number as null, not an empty string", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "Jan", licenceNumber: "   " })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ licenceNumber: null }),
      );
    });

    it.each([
      ["missing name", {}],
      ["blank name", { name: "   " }],
      // Must not be coerced to "42" by the pipe's implicit conversion.
      ["non-string name", { name: 42 }],
      ["non-string licence", { licenceNumber: 42, name: "Jan" }],
      ["object as name", { name: { first: "Jan" } }],
      ["oversized name", { name: "x".repeat(201) }],
      ["invalid email", { name: "Jan", email: "not-an-email" }],
      ["oversized licence", { name: "Jan", licenceNumber: "x".repeat(51) }],
      ["unknown field", { name: "Jan", isActive: false }],
    ])("rejects %s with 400", async (_label, payload) => {
      await request(app.getHttpServer()).post(BASE).send(payload).expect(400);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("returns 409 when the licence number belongs to an active driver", async () => {
      repository.findActiveByLicenceNumber.mockResolvedValue(
        buildDriver({ id: OTHER_DRIVER_ID, licenceNumber: "B-123" }),
      );

      const response = await request(app.getHttpServer())
        .post(BASE)
        .send({ name: "Jan", licenceNumber: "B-123" })
        .expect(409);

      expect(response.body).toMatchObject({
        success: false,
        error: { code: "CONFLICT" },
      });
      expect(response.body.error.message).toContain("B-123");
    });
  });

  describe("PATCH /drivers/:id", () => {
    it("updates the driver", async () => {
      repository.findById.mockResolvedValue(buildDriver());
      repository.update.mockResolvedValue(buildDriver({ name: "New Name" }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${DRIVER_ID}`)
        .send({ name: "New Name" })
        .expect(200);

      expect(response.body.data.name).toBe("New Name");
    });

    it("clears an optional field when null is sent", async () => {
      repository.findById.mockResolvedValue(
        buildDriver({ licenceNumber: "B-123" }),
      );
      repository.update.mockResolvedValue(buildDriver({ licenceNumber: null }));

      await request(app.getHttpServer())
        .patch(`${BASE}/${DRIVER_ID}`)
        .send({ licenceNumber: null })
        .expect(200);

      expect(repository.update).toHaveBeenCalledWith(
        DRIVER_ID,
        expect.objectContaining({ licenceNumber: null }),
      );
    });

    it("rejects a null name, because the column is NOT NULL", async () => {
      repository.findById.mockResolvedValue(buildDriver());

      await request(app.getHttpServer())
        .patch(`${BASE}/${DRIVER_ID}`)
        .send({ name: null })
        .expect(400);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("rejects an attempt to change isActive through update", async () => {
      repository.findById.mockResolvedValue(buildDriver());

      await request(app.getHttpServer())
        .patch(`${BASE}/${DRIVER_ID}`)
        .send({ isActive: false })
        .expect(400);
    });

    it("returns 404 for an unknown driver", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${DRIVER_ID}`)
        .send({ name: "New Name" })
        .expect(404);
    });

    it("returns 409 on a duplicate licence number", async () => {
      repository.findById.mockResolvedValue(buildDriver());
      repository.findActiveByLicenceNumber.mockResolvedValue(
        buildDriver({ id: OTHER_DRIVER_ID, licenceNumber: "B-999" }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${DRIVER_ID}`)
        .send({ licenceNumber: "B-999" })
        .expect(409);
    });
  });

  describe("activation and deactivation", () => {
    it("deactivates without removing the record", async () => {
      repository.findById.mockResolvedValue(buildDriver({ isActive: true }));
      repository.setActive.mockResolvedValue(buildDriver({ isActive: false }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${DRIVER_ID}/deactivation`)
        .expect(200);

      expect(response.body.data.isActive).toBe(false);
      expect(repository.setActive).toHaveBeenCalledWith(DRIVER_ID, false);
    });

    it("activates a previously deactivated driver", async () => {
      repository.findById.mockResolvedValue(buildDriver({ isActive: false }));
      repository.setActive.mockResolvedValue(buildDriver({ isActive: true }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${DRIVER_ID}/activation`)
        .expect(200);

      expect(response.body.data.isActive).toBe(true);
    });

    it("returns 409 when activation would duplicate a licence number", async () => {
      repository.findById.mockResolvedValue(
        buildDriver({ isActive: false, licenceNumber: "B-123" }),
      );
      repository.findActiveByLicenceNumber.mockResolvedValue(
        buildDriver({ id: OTHER_DRIVER_ID, licenceNumber: "B-123" }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${DRIVER_ID}/activation`)
        .expect(409);
    });

    it("returns 404 for an unknown driver", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${DRIVER_ID}/deactivation`)
        .expect(404);
    });
  });

  it("exposes no DELETE route", async () => {
    repository.findById.mockResolvedValue(buildDriver());

    await request(app.getHttpServer()).delete(`${BASE}/${DRIVER_ID}`).expect(404);
  });
});
