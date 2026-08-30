import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { stubTripWriteTransaction } from "./trip-write-transaction.double";
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Prisma, Trip, TripStatus } from "@prisma/client";
import request from "supertest";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { TripController } from "./trip.controller";
import { TripRepository } from "./trip.repository";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripDocumentsService } from "./trip-documents.service";
import { TripService } from "./trip.service";
import { PricingRecalculationService } from "../pricing-engine/pricing-recalculation.service";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_TRIP_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const PDF_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const VEHICLE_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const BASE = "/api/v1/trips";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    pdfDocumentId: PDF_ID,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    isLooseTrip: false,
    isPaid: false,
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
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

const VALID_BODY = {
  pdfDocumentId: PDF_ID,
  bookingNumber: "BK-2026-0042",
  containerType: "45PH",
  destinationCity: "Bousbecque",
  destinationCountry: "France",
  originalPlanningDate: "2026-08-17",
  planningDate: "2026-08-17",
};

/**
 * Integration tests: real routing, the global ValidationPipe, the response
 * interceptor and the exception filter all run. Only the repository and the two
 * collaborating services are stubbed, so no database is required while
 * everything above it is exercised for real.
 */
describe("TripController (integration)", () => {
  let app: INestApplication;
  let repository: jest.Mocked<TripRepository>;
  let vehicleService: { findById: jest.Mock };
  let driverService: { findById: jest.Mock };

  beforeEach(async () => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findByBookingNumber: jest.fn().mockResolvedValue(null),
      findByIdentity: jest.fn().mockResolvedValue(null),
      findManyByBookingNumber: jest.fn().mockResolvedValue([]),
      findManyByIds: jest.fn().mockResolvedValue([]),
      pdfDocumentExists: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockResolvedValue(buildTrip()),
      update: jest.fn().mockResolvedValue(buildTrip()),
      setStatus: jest.fn().mockResolvedValue(buildTrip()),
      setPaid: jest.fn((id: string, isPaid: boolean) =>
        Promise.resolve(buildTrip({ id, isPaid })),
      ),
      runInTransaction: jest.fn(),
      runTripWriteTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripRepository>;

    (repository.runInTransaction as jest.Mock).mockImplementation(
      (work: (repo: TripRepository) => Promise<unknown>) => work(repository),
    );
    (repository.runTripWriteTransaction as jest.Mock).mockImplementation(
      stubTripWriteTransaction(repository),
    );

    vehicleService = {
      findById: jest.fn().mockResolvedValue({ id: VEHICLE_ID, isActive: true }),
    };
    driverService = {
      findById: jest.fn().mockResolvedValue({ isActive: true }),
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
      controllers: [TripController],
      providers: [
        TripService,
        // Not exercised here; the Trips these tests build require no automatic
        // property. It only has to exist for TripService to be constructible.
        /*
         * Editing a waiting time recalculates; nothing in this suite does, so
         * the recalculation only has to exist for TripService to be built.
         */
        {
          provide: PricingRecalculationService,
          useValue: { recalculate: jest.fn() },
        },
        {
          provide: AutomaticFlatPropertyService,
          useValue: { applyToNewTrip: jest.fn(), synchronise: jest.fn() },
        },
        // The documents endpoint has its own tests; this controller only needs
        // it to exist so the rest of the routes can be exercised.
        {
          provide: TripDocumentsService,
          useValue: { findForTrip: jest.fn().mockResolvedValue({ items: [] }) },
        },
        { provide: TripRepository, useValue: repository },
        { provide: VehicleService, useValue: vehicleService },
        { provide: DriverService, useValue: driverService },
        // The effective-driver resolution has its own tests; here it only has
        // to answer, so the HTTP behaviour is exercised in isolation from it.
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
        // The Trip lifecycle announces TripClosed; nothing subscribes here, so
        // the HTTP behaviour is exercised in isolation from pricing.
        {
          provide: DomainEventBus,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
        },
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

  describe("GET /trips", () => {
    it("returns an empty page in the standard envelope", async () => {
      const response = await request(app.getHttpServer()).get(BASE).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        items: [],
        meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
      });
    });

    it("hides DELETED Trips by default", async () => {
      await request(app.getHttpServer()).get(BASE).expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ excludeStatuses: [TripStatus.DELETED] }),
      );
    });

    it("lists DELETED Trips when asked explicitly", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?status=DELETED`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ status: TripStatus.DELETED }),
      );
    });

    it.each([
      ["status=FINISHED", "an unknown status"],
      ["page=0", "a page below one"],
      ["pageSize=201", "a page size above the cap"],
      ["planningDate=2026-02-31", "an impossible calendar date"],
      ["planningDate=17-08-2026", "a non-ISO date"],
      ["vehicleId=not-a-uuid", "a malformed vehicle id"],
      ["unknownFilter=1", "an unknown filter"],
      ["sortBy=terminal", "a field that is not sortable"],
      ["sortBy=startTime&sortDirection=sideways", "an unknown direction"],
    ])("rejects %s (%s)", async (query) => {
      await request(app.getHttpServer()).get(`${BASE}?${query}`).expect(400);
    });

    /**
     * Sorting is a database concern: ordering the page already in the browser
     * would order only what is on screen and misrepresent the rest of the
     * period.
     */
    it.each([
      ["startTime", "asc"],
      ["startTime", "desc"],
      ["endTime", "asc"],
      ["endTime", "desc"],
    ])("sorts by %s %s in the database", async (sortBy, sortDirection) => {
      await request(app.getHttpServer())
        .get(`${BASE}?sortBy=${sortBy}&sortDirection=${sortDirection}`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: { field: sortBy, direction: sortDirection },
        }),
      );
    });

    it("accepts a planning-date range for the weekly view", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?planningDateFrom=2026-08-17&planningDateTo=2026-08-23`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          planningDateFrom: new Date("2026-08-17T00:00:00.000Z"),
          planningDateTo: new Date("2026-08-23T00:00:00.000Z"),
        }),
      );
    });

    it("passes every documented filter through", async () => {
      await request(app.getHttpServer())
        .get(
          `${BASE}?bookingNumber=BK-1&containerNumber=MSKU1&vehicleId=${VEHICLE_ID}&terminal=Antwerp&destinationCity=Bousbecque&destinationCountry=France&search=rot`,
        )
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingNumber: "BK-1",
          containerNumber: "MSKU1",
          vehicleId: VEHICLE_ID,
          terminal: "Antwerp",
          destinationCity: "Bousbecque",
          destinationCountry: "France",
          search: "rot",
        }),
      );
    });

    it("pages", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}?page=3&pageSize=10`)
        .expect(200);

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe("GET /trips/:id", () => {
    it("returns the Trip", async () => {
      repository.findById.mockResolvedValue(buildTrip());

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data.id).toBe(TRIP_ID);
      expect(response.body.data.planningDate).toBe("2026-08-17");
    });

    it("returns 400 for a malformed id", async () => {
      await request(app.getHttpServer()).get(`${BASE}/not-a-uuid`).expect(400);
    });

    it("returns 404 for an unknown id", async () => {
      await request(app.getHttpServer()).get(`${BASE}/${TRIP_ID}`).expect(404);
    });
  });

  describe("POST /trips", () => {
    it("creates a Trip", async () => {
      const response = await request(app.getHttpServer())
        .post(BASE)
        .send(VALID_BODY)
        .expect(201);

      expect(response.body.data.status).toBe(TripStatus.OPEN);
    });

    it("trims the text fields", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...VALID_BODY, bookingNumber: "  BK-2026-0042  " })
        .expect(201);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ bookingNumber: "BK-2026-0042" }),
      );
    });

    it("returns 404 when the PDF document does not exist", async () => {
      repository.pdfDocumentExists.mockResolvedValue(false);

      await request(app.getHttpServer())
        .post(BASE)
        .send(VALID_BODY)
        .expect(404);
    });

    it("returns 409 for an identity already in use", async () => {
      repository.findByIdentity.mockResolvedValue(
        buildTrip({ id: OTHER_TRIP_ID }),
      );

      await request(app.getHttpServer())
        .post(BASE)
        .send(VALID_BODY)
        .expect(409);
    });

    it("returns 409 for an inactive vehicle", async () => {
      vehicleService.findById.mockResolvedValue({
        id: VEHICLE_ID,
        isActive: false,
      });

      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...VALID_BODY, vehicleId: VEHICLE_ID })
        .expect(409);
    });

    /**
     * A Vehicle used to be refused when another Trip occupied its interval.
     * The business removed that rule, so this asserts the acceptance rather
     * than deleting the case: a returning refusal must fail a test.
     */
    it("accepts a Trip on a Vehicle already busy in that interval", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({
          ...VALID_BODY,
          vehicleId: VEHICLE_ID,
          startTime: "08:00",
          endTime: "12:00",
        })
        .expect(201);
    });

    it("accepts a zero distance and a zero waiting time", async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send({ ...VALID_BODY, distanceKm: 0, waitingTimeMinutes: 0 })
        .expect(201);
    });
  });

  describe("PATCH /trips/:id", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildTrip());
    });

    it("updates a manual field", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}`)
        .send({ containerNumber: "MSKU1234567" })
        .expect(200);

      expect(repository.update).toHaveBeenCalledWith(
        TRIP_ID,
        expect.objectContaining({ containerNumber: "MSKU1234567" }),
      );
    });

    it("clears a nullable field with null", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}`)
        .send({ internalNotes: null })
        .expect(200);

      expect(repository.update).toHaveBeenCalledWith(
        TRIP_ID,
        expect.objectContaining({ internalNotes: null }),
      );
    });

    it("accepts an empty body as a no-op", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}`)
        .send({})
        .expect(200);
    });

    it.each([
      ["bookingNumber", "BK-OTHER"],
      ["originalPlanningDate", "2026-08-18"],
      ["pdfDocumentId", PDF_ID],
      ["status", "CLOSED"],
      ["tripGroupId", PDF_ID],
      ["parserMetadata", {}],
      ["containerType", "20TK"],
      ["terminal", "Other"],
    ])("rejects %s, which is not a manual field", async (field, value) => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}`)
        .send({ [field]: value })
        .expect(400);
    });

    /**
     * The fields a transport order states are the ones whose owner depends on
     * the TRIP: the destination and the transport times.
     *
     * This fixture came from a PDF, so the document is still the authority and
     * the request is refused — but as a 409, not a 400: the field exists and is
     * well-formed, and it is this Trip that cannot take it. A Trip created by
     * hand accepts the same body; see the service tests.
     */
    it.each([
      ["destinationCity", "Rotterdam"],
      ["destinationCountry", "Netherlands"],
    ])("refuses %s on an imported Trip", async (field, value) => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}`)
        .send({ [field]: value })
        .expect(409);

      expect(repository.update).not.toHaveBeenCalled();
    });

    /** The transport times are an operator field on any Trip. */
    it.each([
      ["startTime", "09:00"],
      ["endTime", "13:00"],
    ])("accepts %s on an imported Trip", async (field, value) => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}`)
        .send({ [field]: value })
        .expect(200);
    });

    /** Well-formed but wrong shape is still a 400, not a 409. */
    it("refuses a start time that is not a clock time", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}`)
        .send({ startTime: "half twaalf" })
        .expect(400);
    });

    it("returns 404 for an unknown Trip", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}`)
        .send({ internalNotes: "x" })
        .expect(404);
    });

    it("returns 400 for a malformed id", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/not-a-uuid`)
        .send({})
        .expect(400);
    });
  });

  describe("PATCH /trips/:id/status", () => {
    it("closes an OPEN Trip", async () => {
      repository.findById.mockResolvedValue(buildTrip());
      repository.setStatus.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED }),
      );

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/status`)
        .send({ status: "CLOSED" })
        .expect(200);

      expect(response.body.data.status).toBe(TripStatus.CLOSED);
    });

    it("returns 409 for CLOSED back to OPEN", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/status`)
        .send({ status: "OPEN" })
        .expect(409);
    });

    it("returns 400 for DELETED, which has its own endpoint", async () => {
      repository.findById.mockResolvedValue(buildTrip());

      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/status`)
        .send({ status: "DELETED" })
        .expect(400);
    });

    it.each([
      [{}, "a missing status"],
      [{ status: "FINISHED" }, "an unknown status"],
      [{ status: "open" }, "the wrong case"],
      [{ status: "OPEN", extra: 1 }, "an unknown field"],
    ])("rejects %j (%s)", async (body, _reason) => {
      repository.findById.mockResolvedValue(buildTrip());

      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/status`)
        .send(body)
        .expect(400);
    });

    it("returns 404 for an unknown Trip", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/status`)
        .send({ status: "CLOSED" })
        .expect(404);
    });
  });

  /**
   * BETAALD / NIET BETAALD, over HTTP.
   *
   * The endpoint accepts a boolean and nothing else, so no value a caller
   * invents can be stored — the validation pipe refuses the request before the
   * service ever sees it.
   */
  describe("PATCH /trips/:id/payment", () => {
    it("marks a Trip BETAALD", async () => {
      repository.findById.mockResolvedValue(buildTrip());

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/payment`)
        .send({ isPaid: true })
        .expect(200);

      expect(response.body.data.isPaid).toBe(true);
    });

    it("marks it NIET BETAALD again", async () => {
      repository.findById.mockResolvedValue(buildTrip({ isPaid: true }));

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/payment`)
        .send({ isPaid: false })
        .expect(200);

      expect(response.body.data.isPaid).toBe(false);
    });

    /* The whole Trip, so the Ritten row can refresh from the response alone. */
    it("answers with the whole Trip", async () => {
      repository.findById.mockResolvedValue(buildTrip());

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/payment`)
        .send({ isPaid: true })
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: TRIP_ID,
        bookingNumber: "BK-2026-0042",
        status: TripStatus.OPEN,
        isPaid: true,
      });
    });

    it.each([TripStatus.OPEN, TripStatus.CLOSED, TripStatus.CANCELLED])(
      "leaves a %s Trip in that status",
      async (status) => {
        repository.findById.mockResolvedValue(buildTrip({ status }));
        repository.setPaid.mockResolvedValue(
          buildTrip({ status, isPaid: true }),
        );

        const response = await request(app.getHttpServer())
          .patch(`${BASE}/${TRIP_ID}/payment`)
          .send({ isPaid: true })
          .expect(200);

        expect(response.body.data.status).toBe(status);
        expect(repository.setStatus).not.toHaveBeenCalled();
      },
    );

    it.each([
      [{}, "a missing flag"],
      [{ isPaid: "true" }, "a string"],
      [{ isPaid: 1 }, "a number"],
      [{ isPaid: "BETAALD" }, "a label"],
      [{ isPaid: null }, "null"],
      [{ isPaid: true, status: "CLOSED" }, "a smuggled status"],
      [{ isPaid: true, extra: 1 }, "an unknown field"],
    ])("rejects %j (%s)", async (body, _reason) => {
      repository.findById.mockResolvedValue(buildTrip());

      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/payment`)
        .send(body)
        .expect(400);

      expect(repository.setPaid).not.toHaveBeenCalled();
    });

    it("returns 400 for a malformed id", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/not-a-uuid/payment`)
        .send({ isPaid: true })
        .expect(400);
    });

    it("returns 404 for a Trip that does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/payment`)
        .send({ isPaid: true })
        .expect(404);
    });
  });

  describe("PATCH /trips/:id/deletion", () => {
    it("deletes an OPEN Trip", async () => {
      repository.findById.mockResolvedValue(buildTrip());
      repository.setStatus.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED }),
      );

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/deletion`)
        .expect(200);

      expect(response.body.data.status).toBe(TripStatus.DELETED);
    });

    it("returns 409 for a CLOSED Trip", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/deletion`)
        .expect(409);
    });

    it("returns 404 for an unknown Trip", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/deletion`)
        .expect(404);
    });
  });

  describe("PATCH /trips/:id/restoration", () => {
    it("restores a DELETED Trip to OPEN", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED }),
      );
      repository.setStatus.mockResolvedValue(buildTrip());

      const response = await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/restoration`)
        .expect(200);

      expect(response.body.data.status).toBe(TripStatus.OPEN);
    });

    it("returns 409 for a Trip that is not deleted", async () => {
      repository.findById.mockResolvedValue(buildTrip());

      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/restoration`)
        .expect(409);
    });

    it("returns 409 when the identity was taken meanwhile", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED }),
      );
      repository.findByIdentity.mockResolvedValue(
        buildTrip({ id: OTHER_TRIP_ID }),
      );

      await request(app.getHttpServer())
        .patch(`${BASE}/${TRIP_ID}/restoration`)
        .expect(409);
    });
  });

  /**
   * The bulk classification route.
   *
   * A collection sub-resource like `completions`, with the same shape of body
   * and the same all-or-nothing refusal. What it must never become is a generic
   * bulk update: the ids are the entire body, and the classification is what
   * the endpoint is.
   */
  describe("POST /trips/loose", () => {
    const OTHER_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
    const GROUP_ID = "97777777-7777-4777-8777-777777777777";

    function given(...trips: ReturnType<typeof buildTrip>[]): void {
      (repository.findManyByIds as jest.Mock).mockResolvedValue(trips);
    }

    it("marks the named Trips", async () => {
      given(buildTrip({ id: TRIP_ID, isLooseTrip: false }));
      (repository.update as jest.Mock).mockResolvedValue(
        buildTrip({ id: TRIP_ID, isLooseTrip: true }),
      );

      const response = await request(app.getHttpServer())
        .post(`${BASE}/loose`)
        .send({ tripIds: [TRIP_ID] })
        .expect(200);

      expect(response.body.data[0].isLooseTrip).toBe(true);
      expect(repository.update).toHaveBeenCalledWith(TRIP_ID, {
        isLooseTrip: true,
      });
    });

    it("refuses an empty list", async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/loose`)
        .send({ tripIds: [] })
        .expect(400);
    });

    it("refuses the same id twice", async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/loose`)
        .send({ tripIds: [TRIP_ID, TRIP_ID] })
        .expect(400);
    });

    it("refuses a malformed id", async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/loose`)
        .send({ tripIds: ["not-a-uuid"] })
        .expect(400);
    });

    /** The ids are the whole body: nothing else may be smuggled through. */
    it("refuses a body that names anything else", async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/loose`)
        .send({ tripIds: [TRIP_ID], isLooseTrip: false })
        .expect(400);
    });

    it("returns 404 when a Trip does not exist", async () => {
      given();

      await request(app.getHttpServer())
        .post(`${BASE}/loose`)
        .send({ tripIds: [TRIP_ID] })
        .expect(404);
    });

    it("returns 409 for a Trip that belongs to a group", async () => {
      given(buildTrip({ id: TRIP_ID, tripGroupId: GROUP_ID }));

      const response = await request(app.getHttpServer())
        .post(`${BASE}/loose`)
        .send({ tripIds: [TRIP_ID] })
        .expect(409);

      expect(response.body.error.message).toContain(GROUP_ID);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it("returns 409 for a DELETED Trip", async () => {
      given(buildTrip({ id: TRIP_ID, status: TripStatus.DELETED }));

      await request(app.getHttpServer())
        .post(`${BASE}/loose`)
        .send({ tripIds: [TRIP_ID] })
        .expect(409);

      expect(repository.update).not.toHaveBeenCalled();
    });

    /** One grouped Trip refuses the selection it appears in. */
    it("writes nothing when one of several is grouped", async () => {
      given(
        buildTrip({ id: TRIP_ID }),
        buildTrip({ id: OTHER_ID, tripGroupId: GROUP_ID }),
      );

      await request(app.getHttpServer())
        .post(`${BASE}/loose`)
        .send({ tripIds: [TRIP_ID, OTHER_ID] })
        .expect(409);

      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /trips/:id", () => {
    it("is not routed, because Trips are never physically removed", async () => {
      await request(app.getHttpServer())
        .delete(`${BASE}/${TRIP_ID}`)
        .expect(404);
    });
  });

  describe("serialisation", () => {
    it("renders the distance as a string and never leaks parser metadata", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({
          distanceKm: new Prisma.Decimal("132.5"),
          parserMetadata: { rawTerminal: "ANTWERP GATEWAY" },
        }),
      );

      const response = await request(app.getHttpServer())
        .get(`${BASE}/${TRIP_ID}`)
        .expect(200);

      expect(response.body.data.distanceKm).toBe("132.50");
      expect(response.body.data).not.toHaveProperty("parserMetadata");
    });
  });
});
