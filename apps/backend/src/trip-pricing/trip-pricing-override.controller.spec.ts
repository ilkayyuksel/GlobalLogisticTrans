import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Prisma, TripPricingOverride, TripStatus } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { TripService } from "../trips/trip.service";
import { EffectivePricingService } from "./effective-pricing.service";
import { TripPricingOverrideController } from "./trip-pricing-override.controller";
import { TripPricingOverrideRepository } from "./trip-pricing-override.repository";
import { TripPricingOverrideService } from "./trip-pricing-override.service";
import { TripPricingRepository } from "./trip-pricing.repository";
import { TripPricingService } from "./trip-pricing.service";

const TRIP_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const OTHER_TRIP_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bee";
const PRICING_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const BASE = `/api/v1/trip-pricing/trip/${TRIP_ID}/overrides`;

/** The Auth0 subject the simulated guard attaches. */
const SUBJECT = "auth0|operator-1";

/**
 * A Trip the Engine priced at 100.00 with 15% fuel, so the specification's own
 * worked example applies: raising the Tarief to 120.00 must move Brandstof to
 * 18.00.
 *
 * Others is 130.00 — waiting time 30.00 plus TAR 20.00 and Flat 80.00 — which
 * makes it visible that a Tarief correction leaves it alone.
 */
function buildEngineItems() {
  const item = (
    code: string,
    amount: string,
    customPropertyId: string | null = null,
  ) => ({
    pricingComponent: { code },
    amount: new Prisma.Decimal(amount),
    customPropertyId,
    description: code,
  });

  return [
    item("BASE_PRICE", "100.00"),
    item("FUEL_SURCHARGE", "15.00"),
    item("TOLL", "10.00"),
    item("TUNNEL", "5.00"),
    item("WAITING_TIME", "30.00"),
    item("CUSTOM_PROPERTY", "20.00", "prop-tar"),
    item("CUSTOM_PROPERTY", "80.00", "prop-flat"),
    item("COST_CONFIRMATION", "165.00"),
  ];
}

/**
 * An in-memory stand-in for the override table.
 *
 * A fake rather than a mock: these tests need upsert, delete and read to agree
 * with one another, because that agreement is precisely what "changing a price
 * twice replaces the first correction" and "a reset actually removes it" are
 * claims about. Assertions against a mock call list would pass even if the
 * three disagreed.
 */
class FakeOverrideRepository {
  readonly rows = new Map<string, TripPricingOverride>();

  private key(tripId: string, componentCode: string): string {
    return `${tripId}::${componentCode}`;
  }

  findForTrip(tripId: string): Promise<TripPricingOverride[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.tripId === tripId),
    );
  }

  upsert(data: {
    tripId: string;
    componentCode: string;
    amount: Prisma.Decimal;
    overriddenBy: string;
  }): Promise<TripPricingOverride> {
    const row = {
      id: `override-${this.rows.size + 1}`,
      currency: "EUR",
      createdAt: new Date("2026-08-28T10:00:00.000Z"),
      updatedAt: new Date("2026-08-28T10:00:00.000Z"),
      ...data,
    } as TripPricingOverride;

    this.rows.set(this.key(data.tripId, data.componentCode), row);

    return Promise.resolve(row);
  }

  remove(tripId: string, componentCode: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(this.key(tripId, componentCode)));
  }
}

describe("TripPricingOverrideController (integration)", () => {
  let app: INestApplication;
  let overrides: FakeOverrideRepository;
  let items: { findByTripPricingId: jest.Mock };

  beforeEach(async () => {
    overrides = new FakeOverrideRepository();

    items = {
      findByTripPricingId: jest.fn().mockResolvedValue(buildEngineItems()),
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
      controllers: [TripPricingOverrideController],
      providers: [
        TripPricingOverrideService,
        // Real, so the arithmetic under test is the production arithmetic.
        EffectivePricingService,
        { provide: TripPricingOverrideRepository, useValue: overrides },
        { provide: TripPricingItemRepository, useValue: items },
        {
          /*
           * Used only by the batch read, which this controller never calls.
           * Present so the container can build the service, and deliberately
           * left unimplemented so a call would fail loudly.
           */
          provide: TripPricingRepository,
          useValue: {},
        },
        {
          provide: TripPricingService,
          useValue: {
            findByTripId: jest.fn().mockResolvedValue({ id: PRICING_ID }),
          },
        },
        {
          provide: TripService,
          useValue: {
            findById: jest
              .fn()
              .mockResolvedValue({ id: TRIP_ID, status: TripStatus.CLOSED }),
          },
        },
        { provide: AppLoggerService, useValue: logger },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    /*
     * Stands in for AccessTokenGuard, which is not mounted here: it attaches
     * the verified subject to the request, and the point of these tests is that
     * the write path reads the author from THERE and nowhere else.
     */
    app.use((incoming: Request, _response: Response, next: NextFunction) => {
      incoming.auth = { subject: SUBJECT };
      next();
    });

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

  interface ComponentBody {
    componentCode: string;
    engineAmount: string | null;
    effectiveAmount: string;
    source: string;
  }

  function findComponent(
    body: { data: { components: ComponentBody[] } },
    componentCode: string,
  ): ComponentBody | undefined {
    return body.data.components.find(
      (component) => component.componentCode === componentCode,
    );
  }

  describe("PUT — recording a correction", () => {
    it("overrides the Tarief and returns the recalculated breakdown", async () => {
      const response = await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "BASE_PRICE", amount: 120 })
        .expect(200);

      // Fuel follows the corrected Tarief at the snapshot's own 15%, and Others
      // is untouched at 130.00.
      expect(response.body.data.tarief).toBe("120.00");
      expect(response.body.data.brandstof).toBe("18.00");
      expect(response.body.data.others).toBe("130.00");
      expect(response.body.data.totaal).toBe("448.00");
    });

    it("overrides the Toll without disturbing anything but the Total", async () => {
      const response = await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "TOLL", amount: 30 })
        .expect(200);

      expect(response.body.data.tol).toBe("30.00");
      expect(response.body.data.tarief).toBe("100.00");
      expect(response.body.data.brandstof).toBe("15.00");
      // 425.00 with a 10.00 toll, so 20.00 more.
      expect(response.body.data.totaal).toBe("445.00");
    });

    it("overrides the Tunnel without disturbing anything but the Total", async () => {
      const response = await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "TUNNEL", amount: 25 })
        .expect(200);

      expect(response.body.data.tunnel).toBe("25.00");
      expect(response.body.data.brandstof).toBe("15.00");
      expect(response.body.data.totaal).toBe("445.00");
    });

    /** Changing a price twice is one opinion revised, not two rows. */
    it("replaces an existing correction rather than adding a second", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "BASE_PRICE", amount: 120 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "BASE_PRICE", amount: 150 })
        .expect(200);

      expect(response.body.data.tarief).toBe("150.00");
      expect(overrides.rows.size).toBe(1);
    });

    it("keeps the correction, so a later read still sees it", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "BASE_PRICE", amount: 120 })
        .expect(200);

      const stored = await overrides.findForTrip(TRIP_ID);

      expect(stored).toHaveLength(1);
      expect(stored[0].amount.toFixed(2)).toBe("120.00");
    });

    it("marks the component as corrected and keeps the engine figure beside it", async () => {
      const response = await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "BASE_PRICE", amount: 120 })
        .expect(200);

      expect(findComponent(response.body, "BASE_PRICE")).toEqual({
        componentCode: "BASE_PRICE",
        engineAmount: "100.00",
        effectiveAmount: "120.00",
        source: "OVERRIDE",
      });
    });

    it("records the author from the access token", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "BASE_PRICE", amount: 120 })
        .expect(200);

      const [stored] = await overrides.findForTrip(TRIP_ID);

      expect(stored.overriddenBy).toBe(SUBJECT);
    });

    /**
     * The security property, stated as a test: a browser cannot name the author
     * of its own change. The field is not part of the DTO, so the whitelisting
     * pipe refuses the request outright rather than quietly ignoring the value.
     */
    it("refuses a request that tries to name its own author", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({
          componentCode: "BASE_PRICE",
          amount: 120,
          overriddenBy: "auth0|somebody-else",
        })
        .expect(400);

      expect(overrides.rows.size).toBe(0);
    });

    it("stores zero as an explicit amount rather than a withdrawal", async () => {
      const response = await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "TOLL", amount: 0 })
        .expect(200);

      expect(response.body.data.tol).toBe("0.00");
      expect(overrides.rows.size).toBe(1);
      expect(findComponent(response.body, "TOLL")?.source).toBe("OVERRIDE");
    });

    it("leaves other Trips alone", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "BASE_PRICE", amount: 150 })
        .expect(200);

      expect(await overrides.findForTrip(OTHER_TRIP_ID)).toEqual([]);
    });
  });

  /**
   * Every refused component is derived from something the operator can already
   * change, so an override on it would be a second, competing answer.
   */
  describe("PUT — components that admit no correction", () => {
    it.each([
      "FUEL_SURCHARGE",
      "COMBINATION",
      "WAITING_TIME",
      "CUSTOM_PROPERTY",
      "COST_CONFIRMATION",
      "OTHERS",
      "TOTAL",
      "NOT_A_COMPONENT",
    ])("refuses %s", async (componentCode) => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode, amount: 50 })
        .expect(400);

      expect(overrides.rows.size).toBe(0);
    });

    it("refuses a lower-case spelling of an overridable code", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "base_price", amount: 50 })
        .expect(400);
    });
  });

  describe("PUT — amount validation", () => {
    it("refuses more than two decimals", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "TOLL", amount: 10.005 })
        .expect(400);
    });

    it("refuses a negative amount", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "TOLL", amount: -1 })
        .expect(400);
    });

    /** An empty field is not a withdrawal, and it is not a valid amount. */
    it("refuses a missing amount", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "TOLL" })
        .expect(400);

      expect(overrides.rows.size).toBe(0);
    });

    it("refuses an empty string as an amount", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "TOLL", amount: "" })
        .expect(400);

      expect(overrides.rows.size).toBe(0);
    });
  });

  describe("DELETE — withdrawing a correction", () => {
    it("returns the Tarief to the calculated figure and recalculates the fuel", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "BASE_PRICE", amount: 120 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .delete(`${BASE}/BASE_PRICE`)
        .expect(200);

      expect(response.body.data.tarief).toBe("100.00");
      expect(response.body.data.brandstof).toBe("15.00");
      expect(response.body.data.totaal).toBe("425.00");
      expect(overrides.rows.size).toBe(0);
    });

    it("marks the component as calculated again", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "BASE_PRICE", amount: 120 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .delete(`${BASE}/BASE_PRICE`)
        .expect(200);

      expect(findComponent(response.body, "BASE_PRICE")).toEqual({
        componentCode: "BASE_PRICE",
        engineAmount: "100.00",
        effectiveAmount: "100.00",
        source: "ENGINE",
      });
    });

    it("withdraws a Toll correction", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "TOLL", amount: 30 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .delete(`${BASE}/TOLL`)
        .expect(200);

      expect(response.body.data.tol).toBe("10.00");
      expect(response.body.data.totaal).toBe("425.00");
    });

    it("withdraws a Tunnel correction", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "TUNNEL", amount: 25 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .delete(`${BASE}/TUNNEL`)
        .expect(200);

      expect(response.body.data.tunnel).toBe("5.00");
      expect(response.body.data.totaal).toBe("425.00");
    });

    it("withdraws only the named component", async () => {
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "BASE_PRICE", amount: 120 })
        .expect(200);
      await request(app.getHttpServer())
        .put(BASE)
        .send({ componentCode: "TOLL", amount: 30 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .delete(`${BASE}/TOLL`)
        .expect(200);

      expect(response.body.data.tarief).toBe("120.00");
      expect(response.body.data.tol).toBe("10.00");
      expect(overrides.rows.size).toBe(1);
    });

    /** A reset that changed nothing must not report that it did. */
    it("reports a component that carries no correction as not found", async () => {
      await request(app.getHttpServer())
        .delete(`${BASE}/BASE_PRICE`)
        .expect(404);
    });

    it.each(["FUEL_SURCHARGE", "COMBINATION", "COST_CONFIRMATION", "TOTAL"])(
      "refuses to withdraw a correction from %s",
      async (componentCode) => {
        await request(app.getHttpServer())
          .delete(`${BASE}/${componentCode}`)
          .expect(400);
      },
    );
  });
});
