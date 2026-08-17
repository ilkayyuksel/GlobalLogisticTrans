import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Maintenance, MaintenanceStatus, Prisma, Vehicle } from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceRepository } from "./maintenance.repository";
import { MaintenanceService } from "./maintenance.service";

const MAINTENANCE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const VEHICLE_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const BASE = "/api/v1/maintenance";

const VEHICLE = {
  id: VEHICLE_ID,
  licensePlate: "1-ABC-123",
  displayColor: "#2563eb",
  isActive: true,
} as Vehicle;

function buildMaintenance(
  overrides: Partial<Maintenance> = {},
): Maintenance & { vehicle: Vehicle | null } {
  return {
    id: MAINTENANCE_ID,
    vehicleId: VEHICLE_ID,
    trailerId: null,
    status: MaintenanceStatus.COMPLETED,
    maintenanceType: "Onderhoud",
    maintenanceDate: new Date("2026-08-14T00:00:00.000Z"),
    description: "Grote beurt",
    mileage: 245_000,
    cost: new Prisma.Decimal("1250.50"),
    workshop: "Garage Peeters",
    nextMaintenanceDate: new Date("2027-02-14T00:00:00.000Z"),
    nextMaintenanceMileage: 275_000,
    notes: null,
    createdAt: new Date("2026-08-14T00:00:00.000Z"),
    updatedAt: new Date("2026-08-14T00:00:00.000Z"),
    ...overrides,
    vehicle: VEHICLE,
  };
}

const VALID_BODY = {
  vehicleId: VEHICLE_ID,
  status: MaintenanceStatus.COMPLETED,
  maintenanceType: "Onderhoud",
  maintenanceDate: "2026-08-14",
  description: "Grote beurt",
};

/**
 * Maintenance over HTTP: real routing, the global ValidationPipe, the response
 * envelope and the exception filter. Only the repository is stubbed.
 *
 * Two properties matter most here and are asserted repeatedly: money leaves as
 * a fixed-2 STRING and is never summed by a caller, and a mileage is an integer
 * the Administrator typed — never something this system derives.
 */
describe("MaintenanceController (integration)", () => {
  let app: INestApplication;
  let repository: {
    findPage: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    totalsForVehicle: jest.Mock;
    findLatestForVehicle: jest.Mock;
    findLatestWithMileageForVehicle: jest.Mock;
    findNextPlannedForVehicle: jest.Mock;
    vehicleExists: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(buildMaintenance()),
      create: jest.fn().mockResolvedValue(buildMaintenance()),
      update: jest.fn().mockResolvedValue(buildMaintenance()),
      totalsForVehicle: jest
        .fn()
        .mockResolvedValue({ maintenanceCount: 0, totalCost: null }),
      findLatestForVehicle: jest.fn().mockResolvedValue(null),
      findLatestWithMileageForVehicle: jest.fn().mockResolvedValue(null),
      findNextPlannedForVehicle: jest.fn().mockResolvedValue(null),
      vehicleExists: jest.fn().mockResolvedValue(true),
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
      controllers: [MaintenanceController],
      providers: [
        MaintenanceService,
        { provide: MaintenanceRepository, useValue: repository },
        { provide: AppLoggerService, useValue: logger },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    })
      .overrideProvider(AppLoggerService)
      .useValue(logger)
      .compile();

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

  function post(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post(BASE).send(body);
  }

  describe("listing", () => {
    it("returns a page with metadata", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildMaintenance()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer())
        .get(`${BASE}?page=1&pageSize=25`)
        .expect(200);

      expect(response.body.data.meta).toMatchObject({
        page: 1,
        pageSize: 25,
        totalItems: 1,
      });
      expect(response.body.data.items[0]).toMatchObject({
        maintenanceType: "Onderhoud",
        maintenanceDate: "2026-08-14",
        mileage: 245000,
        nextMaintenanceDate: "2027-02-14",
        nextMaintenanceMileage: 275000,
      });
    });

    /** Money leaves as a string; a JSON number would round it. */
    it("renders the cost as a fixed-2 string", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildMaintenance({ cost: new Prisma.Decimal("1250.5") })],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.data.items[0].cost).toBe("1250.50");
    });

    it("embeds the Vehicle so a list needs no extra request", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildMaintenance()],
        totalItems: 1,
      });

      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.data.items[0].vehicle).toMatchObject({
        id: VEHICLE_ID,
        licensePlate: "1-ABC-123",
      });
    });

    it("translates page and pageSize into skip and take", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?page=3&pageSize=10`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it("passes the vehicle and status filters through", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?vehicleId=${VEHICLE_ID}&status=PLANNED`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId: VEHICLE_ID,
          status: MaintenanceStatus.PLANNED,
        }),
      );
    });

    it("converts the date range to UTC midnight", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?maintenanceDateFrom=2026-01-01&maintenanceDateTo=2026-12-31`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          maintenanceDateFrom: new Date("2026-01-01T00:00:00.000Z"),
          maintenanceDateTo: new Date("2026-12-31T00:00:00.000Z"),
        }),
      );
    });

    it("passes the search term through", async () => {
      await request(app.getHttpServer()).get(`${BASE}?search=banden`).expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ search: "banden" }),
      );
    });

    /** Due means a planned DATE has arrived — nothing else. */
    it("asks for due records against today", async () => {
      await request(app.getHttpServer()).get(`${BASE}?dueOnly=true`).expect(200);

      const call = repository.findPage.mock.calls[0][0] as { dueOn?: Date };

      expect(call.dueOn).toBeInstanceOf(Date);
      expect(call.dueOn?.toISOString()).toContain("T00:00:00.000Z");
    });

    it("does not filter by due date unless asked", async () => {
      await request(app.getHttpServer()).get(BASE).expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ dueOn: undefined }),
      );
    });

    it("refuses an invalid filter", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?maintenanceDateFrom=2026-02-31`)
        .expect(400);
      await request(app.getHttpServer()).get(`${BASE}?status=UNKNOWN`).expect(400);
    });
  });

  describe("reading one", () => {
    it("returns it", async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/${MAINTENANCE_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(MAINTENANCE_ID);
    });

    it("reports an unknown record as 404", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer()).get(`${BASE}/${MAINTENANCE_ID}`).expect(404);
    });

    it("refuses a malformed id", async () => {
      await request(app.getHttpServer()).get(`${BASE}/not-a-uuid`).expect(400);
    });
  });

  describe("creating", () => {
    it("stores what was sent", async () => {
      await post({
        ...VALID_BODY,
        mileage: 245000,
        cost: 1250.5,
        workshop: "Garage Peeters",
        nextMaintenanceDate: "2027-02-14",
        nextMaintenanceMileage: 275000,
      }).expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId: VEHICLE_ID,
          maintenanceType: "Onderhoud",
          maintenanceDate: new Date("2026-08-14T00:00:00.000Z"),
          mileage: 245000,
          nextMaintenanceDate: new Date("2027-02-14T00:00:00.000Z"),
          nextMaintenanceMileage: 275000,
        }),
      );
    });

    it("accepts a record with no mileage, cost or next maintenance", async () => {
      await post(VALID_BODY).expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mileage: null,
          cost: null,
          nextMaintenanceDate: null,
          nextMaintenanceMileage: null,
          workshop: null,
          notes: null,
        }),
      );
    });

    it("stores the cost as a Decimal, not a float", async () => {
      await post({ ...VALID_BODY, cost: 1250.5 }).expect(201);

      const data = repository.create.mock.calls[0][0] as { cost: unknown };

      expect(data.cost).toBeInstanceOf(Prisma.Decimal);
      expect((data.cost as Prisma.Decimal).toFixed(2)).toBe("1250.50");
    });

    it("reports an unknown Vehicle as 404", async () => {
      repository.vehicleExists.mockResolvedValue(false);

      const response = await post(VALID_BODY).expect(404);

      expect(response.body.error.message).toContain(VEHICLE_ID);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each([
      ["a malformed vehicle id", { vehicleId: "not-a-uuid" }],
      ["an impossible date", { maintenanceDate: "2026-02-31" }],
      ["an unknown status", { status: "DONE" }],
      ["a negative mileage", { mileage: -1 }],
      ["a fractional mileage", { mileage: 12.5 }],
      ["a negative next mileage", { nextMaintenanceMileage: -5 }],
      ["a fractional next mileage", { nextMaintenanceMileage: 100.25 }],
      ["a negative cost", { cost: -10 }],
      ["a cost with three decimals", { cost: 10.123 }],
      ["an empty description", { description: "" }],
      ["an over-long maintenance type", { maintenanceType: "x".repeat(101) }],
      ["an unknown field", { currentMileage: 1000 }],
      ["a trailer id", { trailerId: VEHICLE_ID }],
    ])("refuses %s", async (_case, patch) => {
      await post({ ...VALID_BODY, ...patch }).expect(400);

      expect(repository.create).not.toHaveBeenCalled();
    });

    /**
     * A blank field means "no value", as everywhere else in this API: the form
     * left it empty rather than saying the work had a type of "   ".
     */
    it("stores a blank maintenance type as null", async () => {
      await post({ ...VALID_BODY, maintenanceType: "   " }).expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ maintenanceType: null }),
      );
    });

    /** A maintenance may be planned, in progress, done, or called off. */
    it.each(Object.values(MaintenanceStatus))("accepts status %s", async (status) => {
      await post({ ...VALID_BODY, status }).expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status }),
      );
    });
  });

  describe("updating", () => {
    function patch(body: Record<string, unknown>) {
      return request(app.getHttpServer())
        .patch(`${BASE}/${MAINTENANCE_ID}`)
        .send(body);
    }

    it("changes only what was sent", async () => {
      await patch({ mileage: 250000 }).expect(200);

      expect(repository.update).toHaveBeenCalledWith(MAINTENANCE_ID, {
        mileage: 250000,
      });
    });

    /** Cancelling is how a maintenance is undone; nothing is deleted. */
    it("cancels a maintenance through its status", async () => {
      await patch({ status: MaintenanceStatus.CANCELLED }).expect(200);

      expect(repository.update).toHaveBeenCalledWith(MAINTENANCE_ID, {
        status: MaintenanceStatus.CANCELLED,
      });
    });

    it("clears a nullable field with null", async () => {
      await patch({ nextMaintenanceDate: null, mileage: null }).expect(200);

      expect(repository.update).toHaveBeenCalledWith(MAINTENANCE_ID, {
        nextMaintenanceDate: null,
        mileage: null,
      });
    });

    it("reports an unknown record as 404", async () => {
      repository.findById.mockResolvedValue(null);

      await patch({ mileage: 1 }).expect(404);
      expect(repository.update).not.toHaveBeenCalled();
    });

    /** A maintenance record is never reassigned to another asset. */
    it("refuses to move the record to another Vehicle", async () => {
      await patch({ vehicleId: VEHICLE_ID }).expect(400);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it.each([
      ["a null status", { status: null }],
      ["a null date", { maintenanceDate: null }],
      ["a null description", { description: null }],
      ["a fractional mileage", { mileage: 0.5 }],
      ["a negative cost", { cost: -1 }],
    ])("refuses %s", async (_case, body) => {
      await patch(body).expect(400);

      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe("the summary", () => {
    it("totals what the database summed", async () => {
      repository.totalsForVehicle.mockResolvedValue({
        maintenanceCount: 3,
        totalCost: new Prisma.Decimal("3250.75"),
      });
      repository.findLatestForVehicle.mockResolvedValue(buildMaintenance());
      repository.findLatestWithMileageForVehicle.mockResolvedValue(
        buildMaintenance(),
      );

      const response = await request(app.getHttpServer())
        .get(`${BASE}/summary/vehicle/${VEHICLE_ID}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        vehicleId: VEHICLE_ID,
        maintenanceCount: 3,
        totalCost: "3250.75",
        latestMileage: 245000,
      });
      expect(response.body.data.latestMaintenance.id).toBe(MAINTENANCE_ID);
    });

    it('reports "0.00" when nothing has been costed', async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/summary/vehicle/${VEHICLE_ID}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        maintenanceCount: 0,
        totalCost: "0.00",
        latestMaintenance: null,
        latestMileage: null,
        nextMaintenanceDate: null,
        isDueByDate: false,
      });
    });

    it("marks a planned date that has arrived as due", async () => {
      repository.findNextPlannedForVehicle.mockResolvedValue(
        buildMaintenance({
          nextMaintenanceDate: new Date("2020-01-01T00:00:00.000Z"),
          nextMaintenanceMileage: 275_000,
        }),
      );

      const response = await request(app.getHttpServer())
        .get(`${BASE}/summary/vehicle/${VEHICLE_ID}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        nextMaintenanceDate: "2020-01-01",
        nextMaintenanceMileage: 275000,
        isDueByDate: true,
      });
    });

    it("does not mark a future date as due", async () => {
      repository.findNextPlannedForVehicle.mockResolvedValue(
        buildMaintenance({
          nextMaintenanceDate: new Date("2099-01-01T00:00:00.000Z"),
        }),
      );

      const response = await request(app.getHttpServer())
        .get(`${BASE}/summary/vehicle/${VEHICLE_ID}`)
        .expect(200);

      expect(response.body.data.isDueByDate).toBe(false);
    });

    /**
     * A planned mileage alone can never make something due: answering that
     * would need the vehicle's current odometer, which does not exist here.
     */
    it("never calls a record due on mileage alone", async () => {
      repository.findNextPlannedForVehicle.mockResolvedValue(null);
      repository.findLatestWithMileageForVehicle.mockResolvedValue(
        buildMaintenance({ mileage: 300_000, nextMaintenanceMileage: 275_000 }),
      );

      const response = await request(app.getHttpServer())
        .get(`${BASE}/summary/vehicle/${VEHICLE_ID}`)
        .expect(200);

      expect(response.body.data.isDueByDate).toBe(false);
      expect(response.body.data.latestMileage).toBe(300000);
    });

    it("reports an unknown Vehicle as 404", async () => {
      repository.vehicleExists.mockResolvedValue(false);

      await request(app.getHttpServer())
        .get(`${BASE}/summary/vehicle/${VEHICLE_ID}`)
        .expect(404);
    });
  });

  /** Maintenance is history: there is no way to remove a record. */
  describe("removal", () => {
    it("exposes no DELETE route", async () => {
      await request(app.getHttpServer())
        .delete(`${BASE}/${MAINTENANCE_ID}`)
        .expect(404);
      await request(app.getHttpServer()).delete(BASE).expect(404);
    });
  });
});
