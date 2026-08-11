import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { VehicleAssignment } from "@prisma/client";
import request from "supertest";

import { toUtcDate } from "../common/dates";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { VehicleAssignmentController } from "./vehicle-assignment.controller";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";
import { VehicleAssignmentService } from "./vehicle-assignment.service";

const ASSIGNMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ASSIGNMENT_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const VEHICLE_ID = "1a1a1a1a-1111-4111-8111-111111111111";
const DRIVER_ID = "2b2b2b2b-2222-4222-8222-222222222222";
const BASE = "/api/v1/vehicle-assignments";

function buildAssignment(
  overrides: Partial<VehicleAssignment> = {},
): VehicleAssignment {
  return {
    id: ASSIGNMENT_ID,
    vehicleId: VEHICLE_ID,
    driverId: DRIVER_ID,
    validFrom: toUtcDate("2026-01-01"),
    validTo: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Integration tests: real routing, the global ValidationPipe, the response
 * interceptor and the exception filter all run. Only the repository and the two
 * collaborating services are stubbed, so no database is required.
 */
describe("VehicleAssignmentController (integration)", () => {
  let app: INestApplication;
  let repository: jest.Mocked<VehicleAssignmentRepository>;
  let vehicleService: { findById: jest.Mock };
  let driverService: { findById: jest.Mock };

  beforeEach(async () => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findOverlapping: jest.fn().mockResolvedValue([]),
      findOpenEndedForVehicle: jest.fn().mockResolvedValue(null),
      findOpenEndedForDriver: jest.fn().mockResolvedValue(null),
      findCurrentForVehicle: jest.fn().mockResolvedValue(null),
      findCurrentForDriver: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildAssignment()),
      update: jest.fn().mockResolvedValue(buildAssignment()),
      setValidTo: jest.fn().mockResolvedValue(buildAssignment()),
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<VehicleAssignmentRepository>;

    repository.runInTransaction.mockImplementation(
      (work: (repo: VehicleAssignmentRepository) => Promise<unknown>) =>
        work(repository),
    );

    vehicleService = { findById: jest.fn().mockResolvedValue({ id: VEHICLE_ID }) };
    driverService = { findById: jest.fn().mockResolvedValue({ id: DRIVER_ID }) };

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [VehicleAssignmentController],
      providers: [
        VehicleAssignmentService,
        { provide: VehicleAssignmentRepository, useValue: repository },
        { provide: VehicleService, useValue: vehicleService },
        { provide: DriverService, useValue: driverService },
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
    vehicleId: VEHICLE_ID,
    driverId: DRIVER_ID,
    validFrom: "2026-03-01",
  };

  describe("GET /vehicle-assignments", () => {
    it("returns a paginated payload inside the standard envelope", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildAssignment()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          items: [
            expect.objectContaining({
              id: ASSIGNMENT_ID,
              validFrom: "2026-01-01",
              validTo: null,
              isOpenEnded: true,
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

    it("filters by vehicle and driver", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?vehicleId=${VEHICLE_ID}&driverId=${DRIVER_ID}`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId: VEHICLE_ID,
          driverId: DRIVER_ID,
        }),
      );
    });

    it("filters by date range", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?from=2026-01-01&to=2026-12-31`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          from: toUtcDate("2026-01-01"),
          to: toUtcDate("2026-12-31"),
        }),
      );
    });

    it("passes activeOnly through as a today filter", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?activeOnly=true`)
        .expect(200);

      expect(repository.findPage.mock.calls[0][0].activeOn).toBeInstanceOf(Date);
    });

    it.each([
      "page=0",
      "pageSize=1000",
      "vehicleId=not-a-uuid",
      "from=31-01-2026",
      "from=2026-02-31",
      "bogus=1",
    ])("rejects invalid query %s", async (queryString) => {
      await request(app.getHttpServer())
        .get(`${BASE}?${queryString}`)
        .expect(400);
    });
  });

  describe("GET /vehicle-assignments/:id", () => {
    it("returns the assignment", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${ASSIGNMENT_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(ASSIGNMENT_ID);
    });

    it("returns 404 for an unknown id", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get(`${BASE}/${ASSIGNMENT_ID}`)
        .expect(404);
    });

    it("returns 400 for a malformed UUID", async () => {
      await request(app.getHttpServer()).get(`${BASE}/not-a-uuid`).expect(400);
    });
  });

  describe("current assignment lookups", () => {
    it("returns the current assignment of a vehicle", async () => {
      repository.findCurrentForVehicle.mockResolvedValue(buildAssignment());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/current/vehicle/${VEHICLE_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(ASSIGNMENT_ID);
    });

    it("returns null when a vehicle has none", async () => {
      repository.findCurrentForVehicle.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .get(`${BASE}/current/vehicle/${VEHICLE_ID}`)
        .expect(200);

      expect(response.body.data).toBeNull();
    });

    it("returns the current assignment of a driver", async () => {
      repository.findCurrentForDriver.mockResolvedValue(buildAssignment());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/current/driver/${DRIVER_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(ASSIGNMENT_ID);
    });

    it("returns 404 when the vehicle does not exist", async () => {
      vehicleService.findById.mockRejectedValue(
        new NotFoundException("Vehicle does not exist."),
      );

      await request(app.getHttpServer())
        .get(`${BASE}/current/vehicle/${VEHICLE_ID}`)
        .expect(404);
    });

    it("returns 400 for a malformed vehicle UUID", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/current/vehicle/not-a-uuid`)
        .expect(400);
    });
  });

  describe("POST /vehicle-assignments", () => {
    it("creates an assignment and answers 201", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send(validPayload)
        .expect(201);

      expect(response.body.data.id).toBe(ASSIGNMENT_ID);
    });

    it("returns 404 when the vehicle does not exist", async () => {
      vehicleService.findById.mockRejectedValue(
        new NotFoundException("Vehicle does not exist."),
      );

      await request(app.getHttpServer()).post(BASE).send(validPayload).expect(404);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("returns 404 when the driver does not exist", async () => {
      driverService.findById.mockRejectedValue(
        new NotFoundException("Driver does not exist."),
      );

      await request(app.getHttpServer()).post(BASE).send(validPayload).expect(404);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("returns 409 on an overlapping period", async () => {
      repository.findOverlapping.mockResolvedValue([
        buildAssignment({ id: OTHER_ASSIGNMENT_ID }),
      ]);

      const response = await request(app.getHttpServer())
        .post(BASE)
        .send(validPayload)
        .expect(409);

      expect(response.body.error.code).toBe("CONFLICT");
    });

    it("returns 400 when validTo precedes validFrom", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...validPayload, validTo: "2026-02-01" })
        .expect(400);
    });

    it("auto-closes the previous open-ended assignment", async () => {
      repository.findOpenEndedForVehicle.mockResolvedValue(
        buildAssignment({
          id: OTHER_ASSIGNMENT_ID,
          validFrom: toUtcDate("2026-01-01"),
        }),
      );

      await request(app.getHttpServer()).post(BASE).send(validPayload).expect(201);

      expect(repository.setValidTo).toHaveBeenCalledWith(
        OTHER_ASSIGNMENT_ID,
        toUtcDate("2026-02-28"),
      );
    });

    it.each([
      ["missing vehicleId", { driverId: DRIVER_ID, validFrom: "2026-03-01" }],
      ["missing driverId", { vehicleId: VEHICLE_ID, validFrom: "2026-03-01" }],
      ["missing validFrom", { vehicleId: VEHICLE_ID, driverId: DRIVER_ID }],
      ["invalid vehicle UUID", { ...validPayload, vehicleId: "nope" }],
      ["invalid date format", { ...validPayload, validFrom: "01-03-2026" }],
      ["impossible date", { ...validPayload, validFrom: "2026-02-31" }],
      ["timestamp instead of date", { ...validPayload, validFrom: "2026-03-01T10:00:00Z" }],
      ["unknown field", { ...validPayload, isActive: true }],
    ])("rejects %s with 400", async (_label, payload) => {
      await request(app.getHttpServer()).post(BASE).send(payload).expect(400);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /vehicle-assignments/:id", () => {
    it("updates the notes", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      await request(app.getHttpServer())
        .patch(`${BASE}/${ASSIGNMENT_ID}`)
        .send({ notes: "corrected" })
        .expect(200);

      expect(repository.update).toHaveBeenCalledWith(
        ASSIGNMENT_ID,
        expect.objectContaining({ notes: "corrected" }),
      );
    });

    it("returns 404 for an unknown assignment", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${ASSIGNMENT_ID}`)
        .send({ notes: "x" })
        .expect(404);
    });

    it("returns 409 when re-dating an assignment that already ended", async () => {
      repository.findById.mockResolvedValue(
        buildAssignment({ validTo: toUtcDate("2020-01-01") }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${ASSIGNMENT_ID}`)
        .send({ validTo: "2020-06-30" })
        .expect(409);
    });

    it.each(["vehicleId", "driverId", "validFrom"])(
      "rejects an attempt to change %s",
      async (field) => {
        repository.findById.mockResolvedValue(buildAssignment());

        await request(app.getHttpServer())
          .patch(`${BASE}/${ASSIGNMENT_ID}`)
          .send({ [field]: VEHICLE_ID })
          .expect(400);
      },
    );
  });

  describe("PATCH /vehicle-assignments/:id/closure", () => {
    it("ends the assignment on the supplied date", async () => {
      repository.findById.mockResolvedValue(buildAssignment());
      repository.setValidTo.mockResolvedValue(
        buildAssignment({ validTo: toUtcDate("2026-06-30") }),
      );

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${ASSIGNMENT_ID}/closure`)
        .send({ validTo: "2026-06-30" })
        .expect(200);

      expect(response.body.data.validTo).toBe("2026-06-30");
      expect(response.body.data.isOpenEnded).toBe(false);
    });

    it("defaults to today when no date is given", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      await request(app.getHttpServer())
        .patch(`${BASE}/${ASSIGNMENT_ID}/closure`)
        .send({})
        .expect(200);

      expect(repository.setValidTo).toHaveBeenCalled();
    });

    it("returns 400 for an end date before the start date", async () => {
      repository.findById.mockResolvedValue(
        buildAssignment({ validFrom: toUtcDate("2026-03-01") }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${ASSIGNMENT_ID}/closure`)
        .send({ validTo: "2026-01-01" })
        .expect(400);
    });

    it("returns 409 when the assignment already ended", async () => {
      repository.findById.mockResolvedValue(
        buildAssignment({ validTo: toUtcDate("2020-01-01") }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${ASSIGNMENT_ID}/closure`)
        .send({})
        .expect(409);
    });

    it("returns 404 for an unknown assignment", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${ASSIGNMENT_ID}/closure`)
        .send({})
        .expect(404);
    });
  });

  it("exposes no DELETE route", async () => {
    repository.findById.mockResolvedValue(buildAssignment());

    await request(app.getHttpServer())
      .delete(`${BASE}/${ASSIGNMENT_ID}`)
      .expect(404);
  });
});
