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
import { TripGroupController } from "./trip-group.controller";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

const TRIP_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TRIP_B = "9c858901-8a57-4791-81fe-4c455b099bc9";
const GROUP_ID = "97777777-7777-4777-8777-777777777777";
const GROUPS = "/api/v1/trip-groups";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_A,
    pdfDocumentId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    tripGroupId: null,
    vehicleId: null,
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

/**
 * Grouping over HTTP: real routing, the global ValidationPipe, the response
 * envelope and the exception filter. Only the repository is stubbed.
 *
 * The status codes are the contract the frontend builds on, so they are what
 * these tests assert — 400 for a request that describes nothing, 404 for a Trip
 * that is not there, 409 for one that is already spoken for.
 */
describe("TripGroupController (integration)", () => {
  let app: INestApplication;
  let repository: {
    findManyByIds: jest.Mock;
    createTripGroup: jest.Mock;
    assignToGroup: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    runInTransaction: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      findManyByIds: jest.fn(),
      createTripGroup: jest.fn().mockResolvedValue({ id: GROUP_ID }),
      assignToGroup: jest.fn().mockResolvedValue(2),
      findById: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      runInTransaction: jest.fn(),
    };

    repository.runInTransaction.mockImplementation(
      (work: (scoped: unknown) => Promise<unknown>) => work(repository),
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
      controllers: [TripGroupController, TripController],
      providers: [
        TripService,
        { provide: TripRepository, useValue: repository },
        { provide: VehicleService, useValue: { findById: jest.fn() } },
        { provide: DriverService, useValue: { findById: jest.fn() } },
        {
          provide: TripPlanningDataService,
          useValue: {
            resolveOne: jest
              .fn()
              .mockResolvedValue({ vehicle: null, effectiveDriver: null }),
            resolveMany: jest.fn((trips: readonly { id: string }[]) =>
              Promise.resolve(
                new Map(
                  trips.map((trip) => [
                    trip.id,
                    { vehicle: null, effectiveDriver: null },
                  ]),
                ),
              ),
            ),
          },
        },
        { provide: DomainEventBus, useValue: { publish: jest.fn() } },
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

  function groupTwoTrips() {
    repository.findManyByIds
      .mockResolvedValueOnce([
        buildTrip({ id: TRIP_A }),
        buildTrip({ id: TRIP_B }),
      ])
      .mockResolvedValueOnce([
        buildTrip({ id: TRIP_A, tripGroupId: GROUP_ID }),
        buildTrip({ id: TRIP_B, tripGroupId: GROUP_ID }),
      ]);

    return request(app.getHttpServer())
      .post(GROUPS)
      .send({ tripIds: [TRIP_A, TRIP_B] });
  }

  describe("creating a group", () => {
    it("returns the group and its Trips", async () => {
      const response = await groupTwoTrips().expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        id: GROUP_ID,
        tripCount: 2,
      });
      expect(
        response.body.data.trips.map((trip: { id: string }) => trip.id),
      ).toEqual([TRIP_A, TRIP_B]);
    });

    it("groups three Trips as readily as two", async () => {
      const third = "5d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
      const ids = [TRIP_A, TRIP_B, third];

      repository.findManyByIds
        .mockResolvedValueOnce(ids.map((id) => buildTrip({ id })))
        .mockResolvedValueOnce(
          ids.map((id) => buildTrip({ id, tripGroupId: GROUP_ID })),
        );

      const response = await request(app.getHttpServer())
        .post(GROUPS)
        .send({ tripIds: ids })
        .expect(201);

      expect(response.body.data.tripCount).toBe(3);
    });
  });

  describe("refusing a request", () => {
    it("refuses fewer than two Trips with 400", async () => {
      await request(app.getHttpServer())
        .post(GROUPS)
        .send({ tripIds: [TRIP_A] })
        .expect(400);
    });

    /** The same id twice would pass a naive count while describing one Trip. */
    it("refuses duplicate ids with 400", async () => {
      const response = await request(app.getHttpServer())
        .post(GROUPS)
        .send({ tripIds: [TRIP_A, TRIP_A] })
        .expect(400);

      expect(JSON.stringify(response.body)).toContain("unique");
    });

    it("refuses a malformed id with 400", async () => {
      await request(app.getHttpServer())
        .post(GROUPS)
        .send({ tripIds: [TRIP_A, "not-a-uuid"] })
        .expect(400);
    });

    it("refuses an unknown Trip with 404", async () => {
      repository.findManyByIds.mockResolvedValueOnce([buildTrip({ id: TRIP_A })]);

      const response = await request(app.getHttpServer())
        .post(GROUPS)
        .send({ tripIds: [TRIP_A, TRIP_B] })
        .expect(404);

      expect(response.body.error.message).toContain(TRIP_B);
    });

    it("refuses an already grouped Trip with 409", async () => {
      repository.findManyByIds.mockResolvedValueOnce([
        buildTrip({ id: TRIP_A }),
        buildTrip({ id: TRIP_B, tripGroupId: GROUP_ID }),
      ]);

      const response = await request(app.getHttpServer())
        .post(GROUPS)
        .send({ tripIds: [TRIP_A, TRIP_B] })
        .expect(409);

      expect(response.body.error.message).toContain("already belongs");
      expect(repository.assignToGroup).not.toHaveBeenCalled();
    });

    it("rejects an unexpected field rather than ignoring it", async () => {
      await request(app.getHttpServer())
        .post(GROUPS)
        .send({ tripIds: [TRIP_A, TRIP_B], name: "morning run" })
        .expect(400);
    });
  });

  describe("unlinking", () => {
    it("clears the group and returns the Trip", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ tripGroupId: GROUP_ID }),
      );
      repository.update.mockResolvedValue(buildTrip({ tripGroupId: null }));

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/trips/${TRIP_A}/group`)
        .send({ tripGroupId: null })
        .expect(200);

      expect(response.body.data.tripGroupId).toBeNull();
      expect(repository.update).toHaveBeenCalledWith(TRIP_A, {
        tripGroupId: null,
      });
    });

    /** Reassignment is not a side effect of unlinking. */
    it("refuses a body that names another group", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ tripGroupId: GROUP_ID }),
      );

      await request(app.getHttpServer())
        .patch(`/api/v1/trips/${TRIP_A}/group`)
        .send({ tripGroupId: GROUP_ID })
        .expect(400);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("reports a Trip that is in no group with 409", async () => {
      repository.findById.mockResolvedValue(buildTrip());

      await request(app.getHttpServer())
        .patch(`/api/v1/trips/${TRIP_A}/group`)
        .send({ tripGroupId: null })
        .expect(409);
    });

    it("reports an unknown Trip with 404", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`/api/v1/trips/${TRIP_A}/group`)
        .send({ tripGroupId: null })
        .expect(404);
    });
  });
});
