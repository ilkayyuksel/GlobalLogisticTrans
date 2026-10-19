import {
  ConflictException,
  INestApplication,
  UnprocessableEntityException,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { MissingPricingSettingException } from "../pricing-engine/exceptions/pricing-engine.exceptions";
import { ManualRouteSelectionService } from "../pricing-engine/manual-route-selection.service";
import { TripRouteChoiceController } from "./trip-route-choice.controller";

const TRIP_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PARTNER_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const ROUTE_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const COMBINATION_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ROUTE = `/api/v1/trip-pricing/trip/${TRIP_ID}/route-choice`;

/**
 * POST /trip-pricing/trip/:tripId/route-choice through the real request
 * pipeline. The service is stubbed: its rules are proven through the real
 * Engine in `manual-route-choice.spec.ts`; this proves the HTTP contract.
 */
describe("TripRouteChoiceController (integration)", () => {
  let app: INestApplication;
  let selection: { choose: jest.Mock };

  beforeEach(async () => {
    selection = { choose: jest.fn().mockResolvedValue([TRIP_ID]) };

    const moduleRef = await Test.createTestingModule({
      controllers: [TripRouteChoiceController],
      providers: [
        { provide: ManualRouteSelectionService, useValue: selection },
        {
          provide: AppLoggerService,
          useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn() },
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

  it("chooses an ordinary route and answers the Trips priced", async () => {
    const response = await request(app.getHttpServer()).post(ROUTE).send({ routePricingId: ROUTE_ID }).expect(200);

    expect(response.body.data).toEqual({ pricedTripIds: [TRIP_ID] });
    expect(selection.choose).toHaveBeenCalledWith(TRIP_ID, { kind: "NORMAL", routePricingId: ROUTE_ID });
  });

  it("chooses a Combination, with the leg when the operator named it", async () => {
    selection.choose.mockResolvedValue([TRIP_ID, PARTNER_ID]);

    const response = await request(app.getHttpServer())
      .post(ROUTE)
      .send({ combinationRouteGroupId: COMBINATION_ID, legPosition: 2 })
      .expect(200);

    expect(response.body.data).toEqual({ pricedTripIds: [TRIP_ID, PARTNER_ID] });
    expect(selection.choose).toHaveBeenCalledWith(TRIP_ID, {
      kind: "COMBINATION",
      combinationRouteGroupId: COMBINATION_ID,
      legPosition: 2,
    });
  });

  it.each([
    ["both ids", { routePricingId: ROUTE_ID, combinationRouteGroupId: COMBINATION_ID }],
    ["neither id", {}],
    ["a malformed id", { routePricingId: "not-a-uuid" }],
    ["a leg that does not exist", { combinationRouteGroupId: COMBINATION_ID, legPosition: 3 }],
    ["an unknown field", { routePricingId: ROUTE_ID, tarief: 10 }],
  ])("refuses %s with 400, changing nothing", async (_case, body) => {
    await request(app.getHttpServer()).post(ROUTE).send(body).expect(400);

    expect(selection.choose).not.toHaveBeenCalled();
  });

  /** The frontend recognises "name the leg" by this code and asks for it. */
  it("answers 422 UNPROCESSABLE_ENTITY when the leg must be named", async () => {
    selection.choose.mockRejectedValue(new UnprocessableEntityException("Kies of deze rit Leg 1 of Leg 2 is."));

    const response = await request(app.getHttpServer())
      .post(ROUTE)
      .send({ combinationRouteGroupId: COMBINATION_ID })
      .expect(422);

    expect(response.body.error.code).toBe("UNPROCESSABLE_ENTITY");
  });

  it("passes a refusal through with its own words", async () => {
    selection.choose.mockRejectedValue(new ConflictException("Alleen voor een afgewerkte rit kan een route gekozen worden."));

    const response = await request(app.getHttpServer()).post(ROUTE).send({ routePricingId: ROUTE_ID }).expect(409);

    expect(response.body.error.message).toBe("Alleen voor een afgewerkte rit kan een route gekozen worden.");
  });

  it("maps an Engine refusal to 409, as every pricing endpoint does", async () => {
    selection.choose.mockRejectedValue(new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"));

    await request(app.getHttpServer()).post(ROUTE).send({ routePricingId: ROUTE_ID }).expect(409);
  });
});
