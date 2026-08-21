import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { TripController } from "./trip.controller";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripDocumentsService } from "./trip-documents.service";
import { TripService } from "./trip.service";

/**
 * Creating a Trip by hand, with nothing filled in.
 *
 * ── WHAT THIS IS ABOUT ──────────────────────────────────────────────────────
 * A Trip used to be, by construction, the product of a parsed transport order.
 * One entered by hand is not: a phone call announces a job, and the booking
 * number, container, destination and date follow later — or never.
 *
 * The rules these tests hold in place:
 *   - an EMPTY body creates a real Trip, OPEN, with nulls;
 *   - absence is stored as null, never as "MANUAL-1" or "UNKNOWN";
 *   - values that ARE supplied are still validated;
 *   - creating a Trip prices nothing and publishes nothing.
 * ────────────────────────────────────────────────────────────────────────────
 */

const BASE = "/api/v1/trips";
const VEHICLE_ID = "25fed53c-1399-4b99-b667-2f7e508eda88";
const PDF_ID = "447c3e09-dc0e-4349-9f2d-8c11b3632c0a";

describe("Manual Trip creation", () => {
  let app: INestApplication;
  let repository: jest.Mocked<TripRepository>;
  let eventBus: { publish: jest.Mock };
  let created: Record<string, unknown> | null;

  beforeEach(async () => {
    created = null;

    repository = {
      pdfDocumentExists: jest.fn().mockResolvedValue(true),
      findByBookingNumber: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      runInTransaction: jest.fn(),
      create: jest.fn(async (data: Record<string, unknown>) => {
        created = data;

        return {
          id: "11111111-1111-4111-8111-111111111111",
          status: TripStatus.OPEN,
          tripGroupId: null,
          vehicleId: null,
          driverId: null,
          containerNumber: null,
          terminal: null,
          startTime: null,
          endTime: null,
          executionDatetime: null,
          waitingTimeMinutes: null,
          distanceKm: null,
          internalNotes: null,
          parserMetadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
      }),
    } as unknown as jest.Mocked<TripRepository>;

    (repository.runInTransaction as jest.Mock).mockImplementation(
      (work: (repo: TripRepository) => Promise<unknown>) => work(repository),
    );

    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [TripController],
      providers: [
        TripService,
        // The documents endpoint has its own tests; this controller only needs
        // it to exist so the rest of the routes can be exercised.
        {
          provide: TripDocumentsService,
          useValue: { findForTrip: jest.fn().mockResolvedValue({ items: [] }) },
        },
        { provide: TripRepository, useValue: repository },
        {
          provide: VehicleService,
          useValue: {
            findById: jest.fn().mockResolvedValue({
              id: VEHICLE_ID,
              isActive: true,
            }),
            findManyByIds: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: DriverService,
          useValue: {
            findById: jest.fn().mockResolvedValue(null),
            findManyByIds: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: TripPlanningDataService,
          useValue: {
            resolveOne: () =>
              Promise.resolve({
                vehicle: null,
                effectiveDriver: null,
                latestUpdate: null,
                costConfirmation: null,
                customProperties: [],
              }),
            resolveMany: () => Promise.resolve(new Map()),
          },
        },
        { provide: DomainEventBus, useValue: eventBus },
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

  describe("a Trip with nothing filled in", () => {
    it("is accepted", async () => {
      await request(app.getHttpServer()).post(BASE).send({}).expect(201);
    });

    it("stores absence as null, for every optional field", async () => {
      await request(app.getHttpServer()).post(BASE).send({}).expect(201);

      expect(created).toMatchObject({
        pdfDocumentId: null,
        bookingNumber: null,
        containerType: null,
        containerNumber: null,
        terminal: null,
        destinationCity: null,
        destinationCountry: null,
        originalPlanningDate: null,
        planningDate: null,
        startTime: null,
        endTime: null,
        vehicleId: null,
        driverId: null,
        waitingTimeMinutes: null,
        distanceKm: null,
        internalNotes: null,
      });
    });

    /**
     * The one thing that must never happen: a value nobody entered. A
     * placeholder would become a string the whole business then has to
     * recognise and strip — in exports, in search, on screen.
     */
    it("invents no placeholder", async () => {
      await request(app.getHttpServer()).post(BASE).send({}).expect(201);

      const stored = JSON.stringify(created);

      expect(stored).not.toMatch(/MANUAL/i);
      expect(stored).not.toMatch(/UNKNOWN/i);
      expect(stored).not.toMatch(/N\/A/i);
      expect(stored).not.toMatch(/TBD|PLACEHOLDER|TEMP/i);
    });

    it("starts OPEN", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send({})
        .expect(201);

      expect(response.body.data.status).toBe(TripStatus.OPEN);
      // Not set explicitly: the column default is what makes OPEN the one entry
      // point into the lifecycle.
      expect(created).not.toHaveProperty("status");
    });

    it("prices nothing and announces nothing", async () => {
      await request(app.getHttpServer()).post(BASE).send({}).expect(201);

      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it("does not look for a PDF that was not referenced", async () => {
      await request(app.getHttpServer()).post(BASE).send({}).expect(201);

      expect(repository.pdfDocumentExists).not.toHaveBeenCalled();
    });

    /** Uniqueness applies to booking numbers that exist; absence cannot collide. */
    it("does not check a booking number it was not given", async () => {
      await request(app.getHttpServer()).post(BASE).send({}).expect(201);

      expect(repository.findByBookingNumber).not.toHaveBeenCalled();
    });
  });

  describe("partially filled in", () => {
    it("accepts a vehicle and nothing else", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ vehicleId: VEHICLE_ID })
        .expect(201);

      expect(created).toMatchObject({ vehicleId: VEHICLE_ID, planningDate: null });
    });

    it("accepts a planning date and nothing else", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ planningDate: "2026-09-01" })
        .expect(201);

      expect(created).toMatchObject({
        planningDate: new Date("2026-09-01T00:00:00.000Z"),
      });
    });

    /**
     * The original planning date records what was planned before anyone moved
     * the Trip. For a Trip created now, that IS the date it is created with, so
     * it is not asked for twice.
     */
    it("takes the original planning date from the planning date", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ planningDate: "2026-09-01" })
        .expect(201);

      expect(created).toMatchObject({
        originalPlanningDate: new Date("2026-09-01T00:00:00.000Z"),
      });
    });

    it("leaves the original date null when there is no date at all", async () => {
      await request(app.getHttpServer()).post(BASE).send({}).expect(201);

      expect(created).toMatchObject({ originalPlanningDate: null });
    });

    it("keeps an explicitly supplied original date", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ planningDate: "2026-09-05", originalPlanningDate: "2026-09-01" })
        .expect(201);

      expect(created).toMatchObject({
        planningDate: new Date("2026-09-05T00:00:00.000Z"),
        originalPlanningDate: new Date("2026-09-01T00:00:00.000Z"),
      });
    });

    it("accepts an empty string as absence rather than as a value", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ bookingNumber: "   ", containerType: "  " })
        .expect(201);

      expect(created).toMatchObject({
        bookingNumber: null,
        containerType: null,
      });
    });
  });

  /**
   * Optional means "may be absent", never "unvalidated". Every rule that
   * applies to a value still applies when one is given.
   */
  describe("what is still refused", () => {
    it.each([
      [{ pdfDocumentId: "not-a-uuid" }, "a malformed PDF id"],
      [{ vehicleId: "not-a-uuid" }, "a malformed vehicle id"],
      [{ planningDate: "17-08-2026" }, "a non-ISO date"],
      [{ planningDate: "2026-02-31" }, "an impossible date"],
      [{ startTime: "25:00" }, "an impossible time"],
      [{ waitingTimeMinutes: -1 }, "a negative wait"],
      [{ distanceKm: -5 }, "a negative distance"],
      [{ bookingNumber: "x".repeat(101) }, "an over-long booking number"],
      [{ status: "CLOSED" }, "a status, which has its own endpoint"],
      [{ unknownField: 1 }, "an unknown field"],
    ] as [Record<string, unknown>, string][])(
      "refuses %j (%s)",
      async (body) => {
        await request(app.getHttpServer()).post(BASE).send(body).expect(400);
      },
    );

    it("still refuses a PDF that does not exist", async () => {
      repository.pdfDocumentExists.mockResolvedValue(false);

      await request(app.getHttpServer())
        .post(BASE)
        .send({ pdfDocumentId: PDF_ID })
        .expect(404);
    });

    it("still refuses a booking number another Trip holds", async () => {
      repository.findByBookingNumber.mockResolvedValue({
        id: "22222222-2222-4222-8222-222222222222",
      } as never);

      await request(app.getHttpServer())
        .post(BASE)
        .send({ bookingNumber: "BK-2026-0042" })
        .expect(409);
    });
  });

  /**
   * The response has to say that these fields are absent. A client cannot tell
   * an absent value from an unfetched one, so null must survive the mapping.
   */
  describe("what the response reports", () => {
    it("returns null for every field that was not given", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send({})
        .expect(201);

      expect(response.body.data).toMatchObject({
        pdfDocumentId: null,
        bookingNumber: null,
        containerType: null,
        destinationCity: null,
        destinationCountry: null,
        planningDate: null,
        originalPlanningDate: null,
      });
    });

    /** No date means no day on which to ask who was assigned. */
    it("resolves no driver for a Trip with no planning date", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send({ vehicleId: VEHICLE_ID })
        .expect(201);

      expect(response.body.data.effectiveDriver).toBeNull();
    });
  });
});
