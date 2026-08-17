import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripService } from "../trips/trip.service";
import { MAX_SNAPSHOT_TRIP_IDS } from "./dto/pricing-snapshots-query.dto";
import { TripPricingController } from "./trip-pricing.controller";
import { TripPricingRepository } from "./trip-pricing.repository";
import { TripPricingService } from "./trip-pricing.service";

/**
 * Reading the stored pricing of many Trips at once.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * An export of a month needs every Trip's pricing. One request per Trip, plus
 * one per snapshot for its lines, is hundreds of round trips for a single file.
 *
 * It is a READ, and these tests pin down that it stays one: it returns what the
 * Pricing Engine already stored, calculates nothing, and never causes a Trip to
 * be priced.
 * ────────────────────────────────────────────────────────────────────────────
 */

const BASE = "/api/v1/trip-pricing/snapshots";
const TRIP_A = "11111111-1111-4111-8111-111111111111";
const TRIP_B = "22222222-2222-4222-8222-222222222222";

function decimal(value: string) {
  return { toFixed: () => value } as never;
}

function buildSnapshot(tripId: string, code: string, amount: string) {
  return {
    id: `pricing-${tripId}`,
    tripId,
    totalPrice: decimal(amount),
    currency: "EUR",
    calculatedAt: new Date("2026-08-17T10:00:00.000Z"),
    pricingEngineVersion: "1.0.0",
    pricingRuleVersion: "2026.1",
    calculationStatus: "CALCULATED",
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      {
        id: `item-${tripId}`,
        tripPricingId: `pricing-${tripId}`,
        pricingComponentId: "component-1",
        pricingComponent: { code },
        customPropertyId: null,
        description: code,
        amount: decimal(amount),
        currency: "EUR",
        calculationOrder: 1,
        quantity: null,
        unitPrice: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  };
}

describe("GET /trip-pricing/snapshots", () => {
  let app: INestApplication;
  let repository: { findManyByTripIds: jest.Mock; findByTripId: jest.Mock };
  let tripService: { findById: jest.Mock };

  beforeEach(async () => {
    repository = {
      findManyByTripIds: jest.fn().mockResolvedValue([]),
      findByTripId: jest.fn().mockResolvedValue(null),
    };
    tripService = { findById: jest.fn().mockResolvedValue({ id: TRIP_A }) };

    const moduleRef = await Test.createTestingModule({
      controllers: [TripPricingController],
      providers: [
        TripPricingService,
        { provide: TripPricingRepository, useValue: repository },
        { provide: TripService, useValue: tripService },
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

  it("returns the snapshots of the Trips asked about", async () => {
    repository.findManyByTripIds.mockResolvedValue([
      buildSnapshot(TRIP_A, "BASE_PRICE", "250.00"),
      buildSnapshot(TRIP_B, "TOLL", "9.75"),
    ]);

    const response = await request(app.getHttpServer())
      .get(`${BASE}?tripIds=${TRIP_A},${TRIP_B}`)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].pricing.tripId).toBe(TRIP_A);
  });

  /**
   * The whole reason the code was added: a UUID says nothing, and no client has
   * a catalog endpoint to resolve it against.
   */
  it("names each line's component by code", async () => {
    repository.findManyByTripIds.mockResolvedValue([
      buildSnapshot(TRIP_A, "FUEL_SURCHARGE", "37.50"),
    ]);

    const response = await request(app.getHttpServer())
      .get(`${BASE}?tripIds=${TRIP_A}`)
      .expect(200);

    expect(response.body.data[0].items[0]).toMatchObject({
      pricingComponentCode: "FUEL_SURCHARGE",
      amount: "37.50",
    });
  });

  it("asks the database once, whatever the number of Trips", async () => {
    await request(app.getHttpServer())
      .get(`${BASE}?tripIds=${TRIP_A},${TRIP_B}`)
      .expect(200);

    expect(repository.findManyByTripIds).toHaveBeenCalledTimes(1);
    expect(repository.findManyByTripIds).toHaveBeenCalledWith([TRIP_A, TRIP_B]);
  });

  /**
   * An unpriced Trip is an ordinary state. Absent, not an error and not an
   * empty snapshot, which a reader could not tell from a priced total of zero.
   */
  it("omits a Trip that has no snapshot", async () => {
    repository.findManyByTripIds.mockResolvedValue([
      buildSnapshot(TRIP_A, "BASE_PRICE", "250.00"),
    ]);

    const response = await request(app.getHttpServer())
      .get(`${BASE}?tripIds=${TRIP_A},${TRIP_B}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
  });

  it("answers with an empty list when none of them is priced", async () => {
    const response = await request(app.getHttpServer())
      .get(`${BASE}?tripIds=${TRIP_A}`)
      .expect(200);

    expect(response.body.data).toEqual([]);
  });

  /** Reading pricing must never cause a Trip to be priced. */
  it("never triggers a calculation", async () => {
    await request(app.getHttpServer())
      .get(`${BASE}?tripIds=${TRIP_A}`)
      .expect(200);

    expect(tripService.findById).not.toHaveBeenCalled();
  });

  describe("what it refuses", () => {
    it.each([
      ["", "an empty list"],
      ["not-a-uuid", "a malformed id"],
      [`${TRIP_A},not-a-uuid`, "one malformed id among valid ones"],
    ])("refuses %p (%s)", async (tripIds) => {
      await request(app.getHttpServer())
        .get(`${BASE}?tripIds=${tripIds}`)
        .expect(400);
    });

    it("refuses more ids than one request may carry", async () => {
      const tooMany = Array.from(
        { length: MAX_SNAPSHOT_TRIP_IDS + 1 },
        (_, index) =>
          `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
      ).join(",");

      await request(app.getHttpServer())
        .get(`${BASE}?tripIds=${tooMany}`)
        .expect(400);
    });

    it("accepts exactly the maximum", async () => {
      const atLimit = Array.from(
        { length: MAX_SNAPSHOT_TRIP_IDS },
        (_, index) =>
          `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
      ).join(",");

      await request(app.getHttpServer())
        .get(`${BASE}?tripIds=${atLimit}`)
        .expect(200);
    });
  });
});
