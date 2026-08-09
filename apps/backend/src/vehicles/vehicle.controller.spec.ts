import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Vehicle } from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleController } from "./vehicle.controller";
import { VehicleRepository } from "./vehicle.repository";
import { VehicleService } from "./vehicle.service";

const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_VEHICLE_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const BASE = "/api/v1/vehicles";

function buildVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: VEHICLE_ID,
    licensePlate: "1-ABC-123",
    displayColor: "#2563eb",
    description: null,
    brand: null,
    model: null,
    year: null,
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
describe("VehicleController (integration)", () => {
  let app: INestApplication;
  let repository: jest.Mocked<VehicleRepository>;

  beforeEach(async () => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findActiveByLicensePlate: jest.fn().mockResolvedValue(null),
      findActiveByDisplayColor: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildVehicle()),
      update: jest.fn().mockResolvedValue(buildVehicle()),
      setActive: jest.fn().mockResolvedValue(buildVehicle()),
    } as unknown as jest.Mocked<VehicleRepository>;

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [VehicleController],
      providers: [
        VehicleService,
        { provide: VehicleRepository, useValue: repository },
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

  describe("GET /vehicles", () => {
    it("returns a paginated payload inside the standard envelope", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildVehicle()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body).toMatchObject({
        success: true,
        statusCode: 200,
        data: {
          items: [expect.objectContaining({ id: VEHICLE_ID })],
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
        .get(`${BASE}?search=%20volvo%20`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ search: "volvo" }),
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

  describe("GET /vehicles/:id", () => {
    it("returns the vehicle", async () => {
      repository.findById.mockResolvedValue(buildVehicle());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${VEHICLE_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(VEHICLE_ID);
    });

    it("returns 404 for an unknown id", async () => {
      repository.findById.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${VEHICLE_ID}`)
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

  describe("POST /vehicles", () => {
    it("creates a vehicle and answers 201", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send({ licensePlate: "1-ABC-123", displayColor: "#2563eb" })
        .expect(201);

      expect(response.body.data.id).toBe(VEHICLE_ID);
    });

    it("trims the licence plate before storing", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ licensePlate: "  1-ABC-123  ", displayColor: "#2563eb" })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ licensePlate: "1-ABC-123" }),
      );
    });

    it("normalises the planning colour to lowercase", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ licensePlate: "1-ABC-123", displayColor: "#2563EB" })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ displayColor: "#2563eb" }),
      );
    });

    it("stores a blank optional field as null", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ licensePlate: "1-ABC-123", displayColor: "#2563eb", brand: "  " })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ brand: null }),
      );
    });

    it.each([
      ["missing plate", { displayColor: "#2563eb" }],
      ["blank plate", { licensePlate: "   ", displayColor: "#2563eb" }],
      ["non-string plate", { licensePlate: 42, displayColor: "#2563eb" }],
      [
        "oversized plate",
        { licensePlate: "x".repeat(21), displayColor: "#2563eb" },
      ],
      ["missing colour", { licensePlate: "1-ABC-123" }],
      ["colour without hash", { licensePlate: "1-ABC-123", displayColor: "2563eb" }],
      ["three-digit colour", { licensePlate: "1-ABC-123", displayColor: "#fff" }],
      ["named colour", { licensePlate: "1-ABC-123", displayColor: "blue" }],
      [
        "colour with bad characters",
        { licensePlate: "1-ABC-123", displayColor: "#zzzzzz" },
      ],
      [
        "year below range",
        { licensePlate: "1-ABC-123", displayColor: "#2563eb", year: 1800 },
      ],
      [
        "year above range",
        { licensePlate: "1-ABC-123", displayColor: "#2563eb", year: 2200 },
      ],
      [
        "non-integer year",
        { licensePlate: "1-ABC-123", displayColor: "#2563eb", year: 2020.5 },
      ],
      [
        "unknown field",
        { licensePlate: "1-ABC-123", displayColor: "#2563eb", isActive: false },
      ],
    ])("rejects %s with 400", async (_label, payload) => {
      await request(app.getHttpServer()).post(BASE).send(payload).expect(400);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("returns 409 when the licence plate belongs to an active vehicle", async () => {
      repository.findActiveByLicensePlate.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      const response = await request(app.getHttpServer())
        .post(BASE)
        .send({ licensePlate: "1-ABC-123", displayColor: "#111111" })
        .expect(409);

      expect(response.body.error.message).toContain("1-ABC-123");
    });

    it("returns 409 when the planning colour belongs to an active vehicle", async () => {
      repository.findActiveByDisplayColor.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      const response = await request(app.getHttpServer())
        .post(BASE)
        .send({ licensePlate: "9-ZZZ-999", displayColor: "#2563eb" })
        .expect(409);

      expect(response.body.error.message).toContain("#2563eb");
    });
  });

  describe("PATCH /vehicles/:id", () => {
    it("updates the vehicle", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.update.mockResolvedValue(buildVehicle({ brand: "Scania" }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}`)
        .send({ brand: "Scania" })
        .expect(200);

      expect(response.body.data.brand).toBe("Scania");
    });

    it("clears an optional field when null is sent", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ notes: "old" }));
      repository.update.mockResolvedValue(buildVehicle({ notes: null }));

      await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}`)
        .send({ notes: null })
        .expect(200);

      expect(repository.update).toHaveBeenCalledWith(
        VEHICLE_ID,
        expect.objectContaining({ notes: null }),
      );
    });

    it.each(["licensePlate", "displayColor"])(
      "rejects a null %s, because the column is NOT NULL",
      async (field) => {
        repository.findById.mockResolvedValue(buildVehicle());

        await request(app.getHttpServer())
          .patch(`${BASE}/${VEHICLE_ID}`)
          .send({ [field]: null })
          .expect(400);

        expect(repository.update).not.toHaveBeenCalled();
      },
    );

    it("rejects an attempt to change isActive through update", async () => {
      repository.findById.mockResolvedValue(buildVehicle());

      await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}`)
        .send({ isActive: false })
        .expect(400);
    });

    it("returns 404 for an unknown vehicle", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}`)
        .send({ brand: "Scania" })
        .expect(404);
    });

    it("returns 409 on a duplicate licence plate", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.findActiveByLicensePlate.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}`)
        .send({ licensePlate: "9-ZZZ-999" })
        .expect(409);
    });

    it("returns 409 on a duplicate planning colour", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.findActiveByDisplayColor.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}`)
        .send({ displayColor: "#16a34a" })
        .expect(409);
    });
  });

  describe("activation and deactivation", () => {
    it("deactivates without removing the record", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: true }));
      repository.setActive.mockResolvedValue(buildVehicle({ isActive: false }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}/deactivation`)
        .expect(200);

      expect(response.body.data.isActive).toBe(false);
      expect(repository.setActive).toHaveBeenCalledWith(VEHICLE_ID, false);
    });

    it("activates a previously deactivated vehicle", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: false }));
      repository.setActive.mockResolvedValue(buildVehicle({ isActive: true }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}/activation`)
        .expect(200);

      expect(response.body.data.isActive).toBe(true);
    });

    it("returns 409 when activation would duplicate a licence plate", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: false }));
      repository.findActiveByLicensePlate.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}/activation`)
        .expect(409);
    });

    it("returns 409 when activation would duplicate a planning colour", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: false }));
      repository.findActiveByDisplayColor.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}/activation`)
        .expect(409);
    });

    it("returns 404 for an unknown vehicle", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${VEHICLE_ID}/deactivation`)
        .expect(404);
    });
  });

  it("exposes no DELETE route", async () => {
    repository.findById.mockResolvedValue(buildVehicle());

    await request(app.getHttpServer())
      .delete(`${BASE}/${VEHICLE_ID}`)
      .expect(404);
  });
});
