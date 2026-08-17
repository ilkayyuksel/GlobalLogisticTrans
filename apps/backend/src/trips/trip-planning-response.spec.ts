import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Trip, TripStatus } from "@prisma/client";
import request from "supertest";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { TripController } from "./trip.controller";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * What a Trip response actually carries over HTTP.
 *
 * The point of the whole change: a planning view must be able to render a Trip
 * — truck and driver by name — from the list response alone, without a request
 * per row.
 */

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const BASE = "/api/v1/trips";

const VEHICLE_SUMMARY = {
  id: "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  licensePlate: "1-ABC-123",
  displayColor: "#2563EB",
  isActive: true,
};

const EFFECTIVE_DRIVER = {
  id: "4d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  name: "Jan Peeters",
  isActive: true,
  source: "VEHICLE_ASSIGNMENT",
};

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    pdfDocumentId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    tripGroupId: null,
    vehicleId: VEHICLE_SUMMARY.id,
    driverId: null,
    status: TripStatus.OPEN,
    direction: null,
    bookingNumber: "BK-2026-0042",
    containerNumber: null,
    containerType: "45PH",
    terminal: null,
    destinationCity: "Bousbecque",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-08-17T00:00:00.000Z"),
    planningDate: new Date("2026-08-17T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("Trip responses carry planning data", () => {
  let app: INestApplication;
  let repository: jest.Mocked<TripRepository>;
  let planningData: { resolveOne: jest.Mock; resolveMany: jest.Mock };

  beforeEach(async () => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(buildTrip()),
    } as unknown as jest.Mocked<TripRepository>;

    planningData = {
      resolveOne: jest.fn().mockResolvedValue({
        vehicle: VEHICLE_SUMMARY,
        effectiveDriver: EFFECTIVE_DRIVER,
      }),
      resolveMany: jest.fn((trips: readonly Trip[]) =>
        Promise.resolve(
          new Map(
            trips.map((trip) => [
              trip.id,
              { vehicle: VEHICLE_SUMMARY, effectiveDriver: EFFECTIVE_DRIVER },
            ]),
          ),
        ),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TripController],
      providers: [
        TripService,
        { provide: TripRepository, useValue: repository },
        { provide: VehicleService, useValue: { findById: jest.fn() } },
        { provide: DriverService, useValue: { findById: jest.fn() } },
        { provide: TripPlanningDataService, useValue: planningData },
        { provide: DomainEventBus, useValue: { publish: jest.fn() } },
        {
          provide: AppLoggerService,
          useValue: {
            setContext: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

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

  describe("GET /trips/:id", () => {
    it("exposes the effective driver with an id and a name", async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data.effectiveDriver).toEqual(EFFECTIVE_DRIVER);
    });

    it("exposes the vehicle summary", async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data.vehicle).toEqual(VEHICLE_SUMMARY);
    });

    it("says how the driver was arrived at", async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data.effectiveDriver.source).toBe(
        "VEHICLE_ASSIGNMENT",
      );
    });

    it("reports null rather than omitting the fields when there is nobody", async () => {
      planningData.resolveOne.mockResolvedValue({
        vehicle: null,
        effectiveDriver: null,
      });

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data).toHaveProperty("vehicle", null);
      expect(response.body.data).toHaveProperty("effectiveDriver", null);
    });
  });

  describe("GET /trips", () => {
    beforeEach(() => {
      repository.findPage.mockResolvedValue({
        items: [
          buildTrip({ id: "trip-1" }),
          buildTrip({ id: "trip-2" }),
          buildTrip({ id: "trip-3" }),
        ],
        totalItems: 3,
      });
    });

    /**
     * The gap this change closes: the board needs names, and the list used to
     * carry only ids.
     */
    it("carries names on every row, not just ids", async () => {
      const response = await request(app.getHttpServer())
        .get(BASE)
        .expect(200);

      for (const item of response.body.data.items) {
        expect(item.vehicle.licensePlate).toBe("1-ABC-123");
        expect(item.effectiveDriver.name).toBe("Jan Peeters");
      }
    });

    /** One resolution for the page, not one per row. */
    it("resolves the whole page in a single call", async () => {
      await request(app.getHttpServer()).get(BASE).expect(200);

      expect(planningData.resolveMany).toHaveBeenCalledTimes(1);
      expect(planningData.resolveOne).not.toHaveBeenCalled();
    });

    it("keeps the raw ids as well, so nothing that used them breaks", async () => {
      const response = await request(app.getHttpServer())
        .get(BASE)
        .expect(200);

      expect(response.body.data.items[0]).toHaveProperty(
        "vehicleId",
        VEHICLE_SUMMARY.id,
      );
      expect(response.body.data.items[0]).toHaveProperty("driverId", null);
    });

    it("resolves an empty page without asking anything", async () => {
      repository.findPage.mockResolvedValue({ items: [], totalItems: 0 });

      const response = await request(app.getHttpServer())
        .get(BASE)
        .expect(200);

      expect(response.body.data.items).toEqual([]);
    });
  });
});
